'use strict';

var _ = require('lodash');
var RouteView = require('./route-view');

var Map = require('es6-unweak-collections').Map;

var Bacon = require('baconjs');
var baconCast = require('bacon-cast');

var CollapsibleSectionView = require('../collapsible-section-view');

var membersMap = new Map();



/**
* @class
* ListRouteViews represent pages within Gmail or Inbox that show a list of emails. Typical examples are the Inbox, Sent Mail,
* Drafts, etc. However, views like the Conversation view or Settings would *not* be a ListRouteView.
* @extends RouteView
*/
var ListRouteView = function(routeViewDriver, driver, appId){
	_bindToEventStream(routeViewDriver, this);

	RouteView.call(this, routeViewDriver);

	var members = {};
	membersMap.set(this, members);

	members.sectionViews = [];
	members.routeViewDriver = routeViewDriver;
	members.driver = driver;
	members.appId = appId;
};

ListRouteView.prototype = Object.create(RouteView.prototype);

_.extend(ListRouteView.prototype, /** @lends ListRouteView */ {

	/**
	 * Adds a collapsible section to the top of the page.
	 * @param {CollapsibleSectionDescriptor} configuration options of the CollapsibleSectionView
	 * @returns {CollapsibleSectionView} the CollapsibleSectionView that was added
	 */
	addCollapsibleSection: function(collapsibleSectionDescriptor){
		var members = membersMap.get(this);

		var collapsibleSectionViewDriver = members.routeViewDriver.addCollapsibleSection(baconCast(Bacon, collapsibleSectionDescriptor).toProperty(), members.appId);
		var collapsibleSectionView = new CollapsibleSectionView(collapsibleSectionViewDriver, members.driver);

		members.sectionViews.push(collapsibleSectionView);
		return collapsibleSectionView;
	}

});

function _bindToEventStream(routeViewDriver, routeView){
	routeViewDriver.getEventStream().onEnd(function(){
		if(!membersMap.has(routeView)){
			return;
		}

		var members = membersMap.get(routeView);

		members.sectionViews.forEach(function(sectionView){
			sectionView.destroy();
		});

		membersMap.delete(routeView);
	});
}

module.exports = ListRouteView;