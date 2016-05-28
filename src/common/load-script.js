/* @flow */
//jshint ignore:start

const once = require('lodash/function/once');
const defer = require('lodash/function/defer');
import connectivityTest from './connectivity-test';
import logError from './log-error';
import ajax from './ajax';
import delay from './delay';

const isContentScript: () => boolean = once(function() {
  if (global.chrome && global.chrome.extension)
    return true;
  if (global.safari && global.safari.extension)
    return true;
  return false;
});

function addScriptToPage(url: string, cors: boolean): Promise<void> {
  const script = document.createElement('script');
  script.type = 'text/javascript';
  if (cors) {
    script.crossOrigin = 'anonymous';
  }

  const promise = new global.Promise(function(resolve, reject) {
    script.addEventListener('error', function(event:any) {
      reject(event.error ||
        new Error(
          event.message || "Load failure: "+url,
          event.filename, event.lineno, event.column));
    }, false);
    script.addEventListener('load', function() {
      // Make sure the script has a moment to execute before this promise
      // resolves.
      defer(resolve);
    }, false);
  });

  script.src = url;
  document.head.appendChild(script);
  return promise;
}

export type LoadScriptOpts = {
  nowrap?: boolean;
  disableSourceMappingURL?: boolean;
};

export default function loadScript(url: string, opts?: LoadScriptOpts): Promise<void> {
  let pr;
  if (isContentScript()) {
    function attempt(retryNum: number, lastErr: ?Error): Promise<void> {
      if (retryNum > 3) {
        throw lastErr || new Error("Ran out of loadScript attempts for unknown reason");
      }

      return ajax({
        url, cachebust: retryNum > 0
      }).then(response => {
        // jshint evil:true

        // Q: Why put the code into a function before executing it instead of
        //    evaling it immediately?
        // A: Chrome would execute it before applying any remembered
        //    breakpoints.
        // Q: Why not just use `... = new Function(...)`?
        // A: The sourcemaps would be off by one line in Chrome because of
        //    https://code.google.com/p/chromium/issues/detail?id=109362
        // Q: indirectEval?
        // A: Using the eval value rather than the eval keyword causes the
        //    code passed to it to be run in the global scope instead of the
        //    current scope. (Seriously, it's a javascript thing.)
        let code = response.text;
        const indirectEval = eval;

        if (opts && opts.disableSourceMappingURL) {
          // Don't remove a data: URI sourcemap
          code = code.replace(/\/\/# sourceMappingURL=[\n:]*\n?$/, '');
        }

        if (!opts || !opts.nowrap) {
          code = "(function(){"+code+"\n});";
        }

        code += "\n//# sourceURL="+url+"\n";

        let program;
        try {
          program = indirectEval(code);
        } catch(err) {
          if (err && err.name === 'SyntaxError') {
            logError(err, {
              retryNum,
              caughtSyntaxError: true,
              url,
              message: `SyntaxError in loading ${url}. Did we not load it fully? Trying again...`
            }, {});
            return delay(5000).then(() => attempt(retryNum+1, err));
          }
          // SyntaxErrors are the only errors that can happen during eval that we
          // retry because sometimes AppEngine doesn't serve the full javascript.
          // No other error is retried because other errors aren't likely to be
          // transient.
          throw err;
        }
        if (!opts || !opts.nowrap) {
          program();
        }
      });
    }
    pr = attempt(0, null);
  } else {
    // Try to add script as CORS first so we can get error stack data from it.
    pr = addScriptToPage(url, true).catch(() => {
      // Only show the warning if we successfully load the script on retry.
      return addScriptToPage(url, false).then(() => {
        console.warn("Script "+url+" included without CORS headers. Error logs might be censored by the browser.");
      });
    });
  }
  pr.catch(err => {
    return connectivityTest().then(connectivityTestResults => {
      logError(err, {
        url,
        connectivityTestResults,
        status: err && err.status,
        response: (err && err.xhr) ? err.xhr.responseText : null,
        message: 'Failed to load script'
      }, {});
    })
  });
  return pr;
}
