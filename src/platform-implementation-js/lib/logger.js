var _ = require('lodash');
var ajax = require('../../common/ajax');
var RSVP = require('rsvp');
var sha256 = require('sha256');
var getStackTrace = require('../../common/get-stack-trace');
var getExtensionId = require('../../common/get-extension-id');
var PersistentQueue = require('./persistent-queue');
var makeMutationObserverStream = require('./dom/make-mutation-observer-stream');

var logger = {};
module.exports = logger;

// Yeah, this module is a singleton with some shared state. This is just for
// logging convenience. Other modules should avoid doing this!
var _appIds = [];
var _LOADER_VERSION;
var _IMPL_VERSION;
var _userEmailHash;
var _useEventTracking;

var _seenErrors = typeof WeakSet == 'undefined' ? null : new WeakSet();

// This will only be true for the first InboxSDK extension to load. This
// first extension is tasked with reporting tracked events to the server.
var _isLoggerMaster = false;
var _sessionId = global.document && document.head.getAttribute('data-inboxsdk-session-id');
if (!_sessionId) {
  _sessionId = Date.now()+'-'+Math.random();
  if (global.document) {
    document.head.setAttribute('data-inboxsdk-session-id', _sessionId);
  }
  _isLoggerMaster = true;
}

var _trackedEventsQueue = new PersistentQueue('events');

// Set up error logging.
logger.setup = function(appId, opts, LOADER_VERSION, IMPL_VERSION) {
  _appIds.push({
    appId: appId,
    version: opts.appVersion || undefined
  });
  if (_LOADER_VERSION) {
    // If we've been set up before, don't do it all again.
    return;
  }
  _LOADER_VERSION = LOADER_VERSION;
  _IMPL_VERSION = IMPL_VERSION;
  _useEventTracking = opts.eventTracking;

  if (opts.globalErrorLogging) {
    if (Error.stackTraceLimit < 30) {
      Error.stackTraceLimit = 30;
    }

    RSVP.on('error', function(err) {
      logger.error(err, "Possibly uncaught promise rejection");
    });

    window.addEventListener('error', function(event) {
      // Ugh, currently Chrome makes this pretty useless. Once Chrome fixes
      // this, we can remove the logged function wrappers around setTimeout and
      // things.
      if (event.error) {
        logger.error(event.error, "Uncaught exception");
      }
    });

    replaceFunction(window, 'setTimeout', function(original) {
      return function wrappedSetTimeout() {
        var args = _.toArray(arguments);
        if (typeof args[0] == 'function') {
          args[0] = makeLoggedFunction(args[0], "setTimeout callback");
        }
        return original.apply(this, args);
      };
    });

    replaceFunction(window, 'setInterval', function(original) {
      return function wrappedSetInterval() {
        var args = _.toArray(arguments);
        if (typeof args[0] == 'function') {
          args[0] = makeLoggedFunction(args[0], "setInterval callback");
        }
        return original.apply(this, args);
      };
    });

    var ETp = window.EventTarget ? window.EventTarget.prototype : window.Node.prototype;
    replaceFunction(ETp, 'addEventListener', function(original) {
      return function wrappedAddEventListener() {
        var args = _.toArray(arguments);
        if (typeof args[1] == 'function') {
          try {
            // If we've made a logger for this function before, use it again,
            // otherwise attach it as a property to the original function.
            // This is necessary so that removeEventListener is called with
            // the right function.
            var loggedFn = args[1].__inboxsdk_logged;
            if (!loggedFn) {
              loggedFn = makeLoggedFunction(args[1], "event listener");
              args[1].__inboxsdk_logged = loggedFn;
            }
            args[1] = loggedFn;
          } catch(e) {
            // This could be triggered if the given function was immutable
            // and stopped us from saving the logged copy on it.
            console.error("Failed to error wrap function", e);
          }
        }
        return original.apply(this, args);
      };
    });

    replaceFunction(ETp, 'removeEventListener', function(original) {
      return function wrappedRemoveEventListener() {
        var args = _.toArray(arguments);
        if (typeof args[1] == 'function' && args[1].__inboxsdk_logged) {
          args[1] = args[1].__inboxsdk_logged;
        }
        return original.apply(this, args);
      };
    });

    replaceFunction(window, 'MutationObserver', function(Original) {
      Original = Original || window.WebKitMutationObserver;

      function WrappedMutationObserver() {
        var args = _.toArray(arguments);
        if (typeof args[0] == 'function') {
          args[0] = makeLoggedFunction(args[0], "MutationObserver callback");
        }
        if (Original.bind && Original.bind.apply) {
          // call constructor with variable number of arguments
          return new (Original.bind.apply(Original, [null].concat(args)))();
        } else {
          // Safari's MutationObserver lacks a bind method, but its constructor
          // doesn't support extra arguments anyway, so don't bother logging an
          // error here.
          return new Original(args[0]);
        }
      }

      // Just in case someone wants to monkey-patch the prototype.
      WrappedMutationObserver.prototype = Original.prototype;

      return WrappedMutationObserver;
    });
  } else {
    // Even if we're set not to log errors, we should still avoid letting RSVP
    // swallow errors entirely.
    RSVP.on('error', function(err) {
      setTimeout(function() {
        throw err;
      }, 0);
    });
  }
};

function haveWeSeenThisErrorAlready(error) {
  if (error && typeof error == 'object') {
    if (_seenErrors) {
      return _seenErrors.has(error);
    } else {
      return error.__alreadyLoggedBySDK;
    }
  }
  return false;
}

function markErrorAsSeen(error) {
  if (error && typeof error == 'object') {
    // Prefer to stick the error in a WeakSet over adding a property to it.
    if (_seenErrors) {
      _seenErrors.add(error);
    } else {
      try {
        Object.defineProperty(error, '__alreadyLoggedBySDK', {
          value: true, enumerable: false
        });
      } catch(extraError) {
        // In case we get an immutable exception
      }
    }
  }
}

function tooManyErrors(err2, originalArgs) {
  console.error("ERROR REPORTING ERROR", err2);
  console.error("ORIGINAL ERROR", originalArgs);
}

// err should be an Error instance, and details can be any JSON-ifiable value.
function _sendError(err, details, appId, sentByApp) {
  if (!global.document) {
    // In tests, just throw the error.
    throw err;
  }

  var args = arguments;

  // It's important that we can't throw an error or leave a rejected promise
  // unheard while logging an error in order to make sure to avoid ever
  // getting into an infinite loop of reporting uncaught errors.
  try {
    if (haveWeSeenThisErrorAlready(err)) {
      return;
    } else {
      markErrorAsSeen(err);
    }

    if (!(err instanceof Error)) {
      console.warn('First parameter to Logger.error was not an error object:', err);
    }

    var appIds = _.cloneDeep(_appIds);
    appIds.some(function(entry) {
      if (entry.appId === appId) {
        entry.causedBy = true;
        return true;
      }
    });

    // Might not have been passed a useful error object with a stack, so get
    // our own current stack just in case.
    var nowStack = getStackTrace();

    // Show the error immediately, don't wait on implementation load for that.
    var stuffToLog = ["Error logged:", err];
    if (err && err.stack) {
      stuffToLog = stuffToLog.concat(["\n\nOriginal error stack:\n"+err.stack]);
    }
    stuffToLog = stuffToLog.concat(["\n\nError logged from:\n"+nowStack]);
    if (details) {
      stuffToLog = stuffToLog.concat(["\n\nError details:", details]);
    }
    stuffToLog = stuffToLog.concat(["\n\nExtension App Ids:", JSON.stringify(appIds, null, 2)]);
    if (sentByApp) {
      stuffToLog = stuffToLog.concat(["\nSent by App:", sentByApp]);
    }
    stuffToLog = stuffToLog.concat(["\nSession Id:", _sessionId]);
    stuffToLog = stuffToLog.concat(["\nExtension Id:", getExtensionId()]);
    stuffToLog = stuffToLog.concat(["\nInboxSDK Loader Version:", _LOADER_VERSION]);
    stuffToLog = stuffToLog.concat(["\nInboxSDK Implementation Version:", _IMPL_VERSION]);

    console.error.apply(console, stuffToLog);

    var report = {
      message: err && err.message || err,
      stack: err && err.stack,
      loggedFrom: nowStack,
      details: details,
      appIds: appIds,
      sessionId: _sessionId,
      emailHash: _userEmailHash,
      extensionId: getExtensionId(),
      loaderVersion: _LOADER_VERSION,
      implementationVersion: _IMPL_VERSION,
      timestamp: new Date().getTime()*1000
    };

    ajax({
      url: 'https://www.inboxsdk.com/api/v2/errors',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      data: JSON.stringify(report)
    }).catch(function(err2) {
      tooManyErrors(err2, args);
    });
  } catch(err2) {
    tooManyErrors(err2, args);
  }
}

logger.error = function(err, details) {
  _sendError(err, details);
};

logger.errorApp = function(appId, err, details) {
  _sendError(err, details, appId, true);
};

function makeLoggedFunction(func, name) {
  return function() {
    try {
      return func.apply(this, arguments);
    } catch (err) {
      var msg = name ? "Uncaught error in "+name : "Uncaught error";
      logger.error(err, msg);
      throw err;
    }
  };
}

function replaceFunction(parent, name, newFnMaker) {
  var newFn = newFnMaker(parent[name]);
  newFn.__original = parent[name];
  parent[name] = newFn;
}

function hash(str) {
  return sha256('inboxsdk:'+str);
}

logger.setUserEmailAddress = function(userEmailAddress) {
  _userEmailHash = hash(userEmailAddress);
};

function track(type, eventName, properties) {
  if (typeof type != 'string') {
    throw new Error("type must be string: "+type);
  }
  if (typeof eventName != 'string') {
    throw new Error("eventName must be string: "+eventName);
  }
  if (properties && typeof properties != 'object') {
    throw new Error("properties must be object or null: "+properties);
  }
  var event = {
    type: type,
    event: eventName,
    timestamp: new Date().getTime()*1000,
    screenWidth: window.screen && window.screen.width,
    screenHeight: window.screen && window.screen.height,
    windowWidth: window.innerWidth,
    windowHeight: window.innerHeight,
    origin: document.location.origin,
    sessionId: _sessionId,
    emailHash: _userEmailHash,
    properties: properties
  };

  if (type != 'gmail') {
    _.extend(event, {
      extensionId: getExtensionId(),
      appIds: _appIds
    });
  }

  if (!global.document) {
    return;
  }

  _trackedEventsQueue.add(event);

  // Signal to the logger master that a new event is ready to be sent.
  document.head.setAttribute('data-inboxsdk-last-event', Date.now());
}

if (_isLoggerMaster && global.document) {
  makeMutationObserverStream(document.head, {
    attributes: true, attributeFilter: ['data-inboxsdk-last-event']
  }).map(null).throttle(30*1000).onValue(function() {
    var events = _trackedEventsQueue.removeAll();

    ajax({
      url: 'https://www.inboxsdk.com/api/v2/events',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      data: JSON.stringify({
        data: events,
        timestamp: new Date().getTime()*1000
      })
    });
  });
}

// Should only be used by the InboxSDK users for their own app events.
logger.eventApp = function(appId, eventName, details) {
  if (details && typeof details != 'object') {
    throw new Error("details must be object or null: "+details);
  }
  track('app', eventName, _.extend({}, details, {appId:appId}));
};

// For tracking app events that are possibly triggered by the user. Extensions
// can opt out of this with a flag passed to InboxSDK.load().
logger.eventSdkActive = function(eventName, details) {
  if (!_useEventTracking) {
    return;
  }
  track('sdkActive', eventName, details);
};

// Track events unrelated to user activity about how the app uses the SDK.
// Examples include the app being initialized, and calls to any of the
// register___ViewHandler functions.
logger.eventSdkPassive = function(eventName, details) {
  track('sdkPassive', eventName, details);
};

// Track Gmail events.
logger.eventGmail = function(eventName, details) {
  // Only the first InboxSDK extension reports Gmail events.
  if (!_isLoggerMaster || !_useEventTracking) {
    return;
  }
  track('gmail', eventName, details);
};