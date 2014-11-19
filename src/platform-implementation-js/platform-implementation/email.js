var _ = require('lodash');
var $ = require('jquery');
var RSVP = require('rsvp');

var Email = function(appId, driver){
	this._appId = appId;
	this._driver = driver;
};

_.extend(Email.prototype, {

	getUserAsync: function() {
		return RSVP.Promise.resolve({
			displayName: 'Bob Example',
			emailAddress: 'bob@example.com'
		});
	},

});

module.exports = Email;