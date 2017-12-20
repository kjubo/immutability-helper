var invariant = require('invariant');
var Immutable = require('immutable');

var hasOwnProperty = Object.prototype.hasOwnProperty;
var splice = Array.prototype.splice;

var toString = Object.prototype.toString
var type = function (obj) {
  return toString.call(obj).slice(8, -1);
}

var assign = Object.assign || /* istanbul ignore next */ function assign(target, source) {
  getAllKeys(source).forEach(function (key) {
    if (hasOwnProperty.call(source, key)) {
      target[key] = source[key];
    }
  });
  return target;
};

var getAllKeys = typeof Object.getOwnPropertySymbols === 'function' ?
  function (obj) { return Object.keys(obj).concat(Object.getOwnPropertySymbols(obj)) } :
  /* istanbul ignore next */ function (obj) { return Object.keys(obj) };

/* istanbul ignore next */
function copy(object) {
  if (Array.isArray(object)) {
    return assign(object.constructor(object.length), object)
  } else if (type(object) === 'Map') {
    return new Map(object)
  } else if (type(object) === 'Set') {
    return new Set(object)
  } else if (object && typeof object === 'object') {
    var prototype = object.constructor && object.constructor.prototype
    return assign(Object.create(prototype || null), object);
  } else {
    return object;
  }
}

function newContext() {
  var commands = assign({}, defaultCommands);
  update.extend = function (directive, fn) {
    commands[directive] = fn;
  };
  update.isEquals = function (a, b) { return a === b; };

  return update;

  function update(object, spec) {
    if (typeof spec === 'function') {
      return Immutable.fromJS(spec(object));
    }

    if (!(object instanceof Immutable.List && Array.isArray(spec))) {
      invariant(
        !Array.isArray(spec),
        'update(): You provided an invalid spec to update(). The spec may ' +
        'not contain an array except as the value of $set, $push, $unshift, ' +
        '$splice or any custom command allowing an array value.'
      );
    }

    invariant(
      typeof spec === 'object' && spec !== null,
      'update(): You provided an invalid spec to update(). The spec and ' +
      'every included key path must be plain objects containing one of the ' +
      'following commands: %s.',
      Object.keys(commands).join(', ')
    );

    var nextObject = object;
    var index, key;
    getAllKeys(spec).forEach(function (key) {
      if (hasOwnProperty.call(commands, key)) {
        nextObject = commands[key](spec[key], nextObject, spec, object);
      } else {
        nextObject = nextObject.set(key, update(object instanceof Immutable.Map || object instanceof Immutable.List ? object.get(key, null) : undefined, spec[key]));
      }
    });
    return nextObject;
  }

}

var defaultCommands = {
  $push: function (value, nextObject, spec) {
    invariantPushAndUnshift(nextObject, spec, '$push');
    return value.length ? nextObject.concat(value) : nextObject;
  },
  $unshift: function (value, nextObject, spec) {
    invariantPushAndUnshift(nextObject, spec, '$unshift');
    return value.length ? Immutable.fromJS(value).concat(nextObject) : nextObject;
  },
  $splice: function (value, nextObject, spec, originalObject) {
    invariantSplices(nextObject, spec);
    return value.reduce((nextObject, args) => {
      invariantSplice(args);
      return Immutable.Collection.Indexed.prototype.splice.apply(nextObject, args);
    }, nextObject);
  },
  $set: function (value, nextObject, spec) {
    invariantSet(spec);
    return Immutable.fromJS(value);
  },
  $toggle: function (targets, nextObject) {
    invariantSpecArray(targets, '$toggle');
    return targets.reduce(function (prev, target) {
      return prev.set(target, !nextObject.get(target));
    }, nextObject);
  },
  $unset: function (value, nextObject, spec, originalObject) {
    invariantSpecArray(value, '$unset');
    return nextObject.deleteAll(value);
  },
  $add: function (value, nextObject, spec, originalObject) {
    invariantMapOrSet(nextObject, '$add');
    invariantSpecArray(value, '$add');
    if (nextObject instanceof Immutable.Map) {
      value.forEach(function (pair) {
        var key = pair[0];
        var value = pair[1];
        nextObject = nextObject.set(key, value);
      });
    } else {
      value.forEach(function (value) {
        nextObject = nextObject.add(value);
      });
    }
    return nextObject;
  },
  $remove: function (value, nextObject, spec, originalObject) {
    invariantMapOrSet(nextObject, '$remove');
    invariantSpecArray(value, '$remove');
    return nextObject instanceof Immutable.Map
      ? nextObject.removeAll(value)
      : value.reduce((prev, key) => prev.remove(key), nextObject);
  },
  $merge: function (value, nextObject, spec, originalObject) {
    invariantMerge(nextObject, value);
    return nextObject.merge(value);
  },
  $apply: function (value, original) {
    invariantApply(value);
    return Immutable.fromJS(value(original));
  }
};

module.exports = newContext();
module.exports.newContext = newContext;

// invariants

function invariantPushAndUnshift(value, spec, command) {
  invariant(
    value instanceof Immutable.List,
    'update(): expected target of %s to be an immutable List; got %s.',
    command,
    value
  );
  invariantSpecArray(spec[command], command)
}

function invariantSpecArray(spec, command) {
  invariant(
    Array.isArray(spec),
    'update(): expected spec of %s to be an array; got %s. ' +
    'Did you forget to wrap your parameter in an array?',
    command,
    spec
  );
}

function invariantSplices(value, spec) {
  invariant(
    value instanceof Immutable.List,
    'Expected $splice target to be an immutable List; got %s',
    value
  );
  invariantSplice(spec['$splice']);
}

function invariantSplice(value) {
  invariant(
    Array.isArray(value),
    'update(): expected spec of $splice to be an array of arrays; got %s. ' +
    'Did you forget to wrap your parameters in an array?',
    value
  );
}

function invariantApply(fn) {
  invariant(
    typeof fn === 'function',
    'update(): expected spec of $apply to be a function; got %s.',
    fn
  );
}

function invariantSet(spec) {
  invariant(
    Object.keys(spec).length === 1,
    'Cannot have more than one key in an object with $set'
  );
}

function invariantMerge(target, specValue) {
  invariant(
    specValue && typeof specValue === 'object',
    'update(): $merge expects a spec of type \'object\'; got %s',
    specValue
  );
  invariant(
    target && target instanceof Immutable.Map,
    'update(): $merge expects a target of type \'immutable Map\'; got %s',
    target
  );
}

function invariantMapOrSet(target, command) {
  invariant(
    target instanceof Immutable.Map || target instanceof Immutable.Set,
    'update(): %s expects a target of type Set or Map; got %s',
    command,
    target.constructor.name
  );
}
