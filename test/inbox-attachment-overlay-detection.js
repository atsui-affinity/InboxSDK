/* @flow */

import _ from 'lodash';
import fs from 'fs';
import assert from 'assert';
import sinon from 'sinon';
import Kefir from 'kefir';
import jsdomDoc from './lib/jsdom-doc';
import fakePageGlobals from './lib/fake-page-globals';
import querySelector from '../src/platform-implementation-js/lib/dom/querySelectorOrFail';

import finder from '../src/platform-implementation-js/dom-driver/inbox/detection/attachmentOverlay/finder';
import parser from '../src/platform-implementation-js/dom-driver/inbox/detection/attachmentOverlay/parser';
import watcher from '../src/platform-implementation-js/dom-driver/inbox/detection/attachmentOverlay/watcher';

import {
  page20160816,
  page20160817,
  page20160830,
  page20170209,
} from './lib/pages';

describe('Inbox Attachment Overlay Detection', function() {
  this.slow(5000);
  this.timeout(10000);

  fakePageGlobals();

  describe('finder', function() {
    it('2016-08-16 message with attachment', function() {
      const results = finder(page20160816());
      assert.strictEqual(results.length, 0);
    });

    it('2016-08-17 with preview overlay', function() {
      const overlay = querySelector((querySelector(page20160817(), 'iframe#FfJ3bf'):any).contentDocument, '[data-test-id=overlay]');
      const results = finder(page20160817());
      assert.strictEqual(results.length, 1);
      assert(results.includes(overlay));
    });
  });

  describe('parser', function() {
    it('2016-08-17 with preview overlay', function() {
      const overlay = querySelector((querySelector(page20160817(), 'iframe#FfJ3bf'):any).contentDocument, '[data-test-id=overlay]');
      const results = parser(overlay);
      assert.deepEqual(results.errors, []);
      assert.strictEqual(results.score, 1);
    });

    it('2016-08-30', function() {
      const overlay = querySelector(page20160830(), '[data-test-id=overlay]');
      const results = parser(overlay);
      assert.deepEqual(results.errors, []);
      assert.strictEqual(results.score, 1);
      assert.strictEqual(results.elements.downloadButton, querySelector(page20160830(), '[data-test-id="downloadButton"]'));
    });

    it('2017-02-09', function() {
      const overlay = querySelector(page20170209(), '[data-test-id=overlay]');
      const results = parser(overlay);
      assert.deepEqual(results.errors, []);
      assert.strictEqual(results.score, 1);
      assert.strictEqual(results.elements.downloadButton, querySelector(page20170209(), '[data-test-id="downloadButton"]'));
    });
  });

  describe('watcher', function() {
    it('2016-08-16 message with attachment', function(cb) {
      const spy = sinon.spy();
      watcher(page20160816())
        .takeUntilBy(Kefir.later(50))
        .onValue(spy)
        .onEnd(() => {
          const results = spy.args.map(callArgs => callArgs[0].el);
          assert.strictEqual(results.length, 0);
          cb();
        });
    });

    it('2016-08-17 with preview overlay', function(cb) {
      const overlay = querySelector((querySelector(page20160817(), 'iframe#FfJ3bf'):any).contentDocument, '[data-test-id=overlay]');

      const spy = sinon.spy();
      watcher(page20160817())
        .takeUntilBy(Kefir.later(50))
        .onValue(spy)
        .onEnd(() => {
          const results = spy.args.map(callArgs => callArgs[0].el);
          assert.strictEqual(results.length, 1);
          assert(results.includes(overlay));
          cb();
        });
    });
  });
});
