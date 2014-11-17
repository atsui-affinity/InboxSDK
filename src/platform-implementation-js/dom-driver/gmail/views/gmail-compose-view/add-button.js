var _ = require('lodash');

var waitFor = require('../../../../lib/wait-for');
var simulateClick = require('../../../../lib/dom/simulate-click');

var ButtonView = require('../../widgets/buttons/button-view');
var BasicButtonViewController = require('../../../../widgets/buttons/basic-button-view-controller');
var MenuButtonViewController = require('../../../../widgets/buttons/menu-button-view-controller');

var MenuView = require('../../widgets/menu-view');

function addButton(gmailComposeView, buttonDescriptor){
	if(buttonDescriptor.onValue){
		_addButtonStream(gmailComposeView, buttonDescriptor);
	}
	else{
		_addButton(gmailComposeView, buttonDescriptor);
	}
}

function _addButtonStream(gmailComposeView, buttonDescriptorStream){
	var buttonViewController;

	var unsubscribeFunction = buttonDescriptorStream.onValue(function(buttonDescriptor){

		var buttonOptions = _processButtonDescriptor(buttonDescriptor);

		if(!buttonViewController){
			buttonViewController = _addButton(gmailComposeView, buttonOptions);
		}
		else{
			buttonViewController.getView().update(buttonOptions);
		}
	});

	gmailComposeView.addUnsubscribeFunction(unsubscribeFunction);
}

function _addButton(gmailComposeView, buttonDescriptor){
	var buttonOptions = _processButtonDescriptor(buttonDescriptor);
	var buttonViewController;

	if(!buttonOptions.section || buttonOptions.section === 'TRAY_LEFT'){
		buttonViewController = _addButtonToTrayLeft(gmailComposeView, buttonOptions);
	}
	else if(buttonOptions.section === 'SEND_RIGHT'){
		buttonViewController = _addButtonToSendRight(gmailComposeView, buttonOptions);
	}

	_groupButtonsIfNeeded(gmailComposeView);

	return buttonViewController;
}

function _addButtonToTrayLeft(gmailComposeView, buttonDescriptor){
	var buttonViewController = _getButtonViewController(buttonDescriptor);
	buttonViewController.getView().addClass('wG');
	buttonViewController.getView().getElement().setAttribute('tabindex', 1);

	var formattingAreaOffsetLeft = gmailComposeView._getFormattingAreaOffsetLeft();
	var element = buttonViewController.getView().getElement();

	var actionToolbar = gmailComposeView.getAdditionalActionToolbar();

	actionToolbar.insertBefore(element, actionToolbar.firstElementChild);
	gmailComposeView.updateInsertMoreAreaLeft(formattingAreaOffsetLeft);

	gmailComposeView.addManagedViewController(buttonViewController);

	return buttonViewController;
}

function _addButtonToSendRight(gmailComposeView, buttonDescriptor){
	var buttonViewController = _getButtonViewController(buttonDescriptor);
	buttonViewController.getView().addClass('inboxsdk__compose_sendButton');
	buttonViewController.getView().addClass('aoO');
	buttonViewController.getView().getElement().setAttribute('tabindex', 1);

	var sendButtonElement = gmailComposeView.getSendButton();

	sendButtonElement.insertAdjacentElement('afterend', buttonViewController.getView().getElement());
	gmailComposeView.addManagedViewController(buttonViewController);

	return buttonViewController;
}

function _getButtonViewController(buttonDescriptor){
	var buttonViewController = null;

	var buttonView = new ButtonView(buttonDescriptor);
	buttonDescriptor.buttonView = buttonView;

	if(buttonDescriptor.hasDropdown){
		var menuView = new MenuView();
		buttonDescriptor.menuView = menuView;
		buttonDescriptor.menuPositionOptions = {isBottomAligned: true};
		buttonViewController = new MenuButtonViewController(buttonDescriptor);
	}
	else{
		buttonViewController = new BasicButtonViewController(buttonDescriptor);
	}

	return buttonViewController;
}

function _processButtonDescriptor(buttonDescriptor){
	var buttonOptions = _.clone(buttonDescriptor);
	if(buttonDescriptor.hasDropdown){
		buttonOptions.postMenuShowFunction = function(menuView){
			buttonDescriptor.onClick({
				dropdown: {
					el: menuView.getElement()
				}
			});
		};
	}
	else{
		buttonOptions.activateFunction = buttonDescriptor.onClick;
	}

	buttonOptions.noArrow = true;
	buttonOptions.tooltip = buttonOptions.tooltip || buttonOptions.title;
	delete buttonOptions.title;

	if(buttonOptions.section === 'TRAY_LEFT'){
		buttonOptions.buttonColor = 'flatIcon';
	}
	else if(buttonOptions.section === 'SEND_RIGHT'){
		buttonOptions.buttonColor = 'blue';
	}

	return buttonOptions;
}

function _groupButtonsIfNeeded(gmailComposeView){
	if(!_doButtonsNeedToGroup(gmailComposeView)){
		return;
	}

	var groupedActionToolbarContainer = _createGroupedActionToolbarContainer(gmailComposeView);
	var groupToggleButtonViewController = _createGroupToggleButtonViewController(gmailComposeView, groupedActionToolbarContainer);


	_swapToActionToolbar(gmailComposeView, groupToggleButtonViewController);
	_checkAndSetInitialState(gmailComposeView, groupToggleButtonViewController);
	_startMonitoringFormattingToolbar(gmailComposeView, groupToggleButtonViewController);
}

function _doButtonsNeedToGroup(gmailComposeView){
	return !gmailComposeView.getElement().querySelector('.inboxsdk__compose_groupedActionToolbar')
			&& gmailComposeView.getElement().clientWidth < gmailComposeView.getBottomBarTable().clientWidth
			&& gmailComposeView.getElement().querySelectorAll('.inboxsdk__button').length > 2;
}

function _createGroupedActionToolbarContainer(gmailComposeView){
	var groupedActionToolbarContainer = document.createElement('div');
	groupedActionToolbarContainer.classList.add('inboxsdk__compose_groupedActionToolbar');

	gmailComposeView._additionalAreas.groupedActionToolbarContainer = groupedActionToolbarContainer;
	groupedActionToolbarContainer.style.display = 'none';
}

function _createGroupToggleButtonViewController(gmailComposeView){
	var buttonView = _createGroupToggleButtonView();

	var isExpanded = false;
	var buttonViewController = new BasicButtonViewController({
		buttonView: buttonView,
		activateFunction: function(){
			isExpanded = _toggleGroupButtonToolbar(gmailComposeView, buttonViewController, isExpanded);
		}
	});

	gmailComposeView._additionalAreas.groupedActionToolbarContainer.addEventListener(
		'keydown',
		function(event){
			if(event.which === 27) { //escape
				buttonViewController.activate();

				buttonView.getElement().focus();

				event.preventDefault();
				event.stopPropagation();
			}
		}
	);

	gmailComposeView.addManagedViewController(buttonViewController);

	return buttonViewController;
}

function _createGroupToggleButtonView(){
	var buttonView = new ButtonView({
		tooltip: 'More Tools',
		iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABMAAAATCAYAAAByUDbMAAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAAsTAAALEwEAmpwYAAAANUlEQVQ4y2NgGKyAkZCC/1OY/sMV5/zDq56Jmi4bNYyC2ESONZINgcbyEPDmaKIdBoYNXgAA8hYMHFMqIjsAAAAASUVORK5CYII=',
		buttonColor: 'flatIcon'
	});

	buttonView.addClass('wG');
	buttonView.getElement().setAttribute('tabindex', 1);

	return buttonView;
}

function _toggleGroupButtonToolbar(gmailComposeView, buttonViewController, isExpanded){
	if(isExpanded){ //collapse
		gmailComposeView._additionalAreas.groupedActionToolbarContainer.style.display = 'none';
		gmailComposeView.getElement().classList.remove('inboxsdk__compose_groupedActionToolbar_visible');

		buttonViewController.getView().deactivate();
		localStorage['inboxsdk__compose_groupedActionButton_state'] = 'collapsed';
	}
	else{ //expand
		gmailComposeView._additionalAreas.groupedActionToolbarContainer.style.display = '';
		gmailComposeView._additionalAreas.groupedActionToolbarContainer.style.left = buttonViewController.getView().getElement().offsetLeft + 'px';
		gmailComposeView._additionalAreas.groupedActionToolbarContainer.style.marginLeft = (buttonViewController.getView().getElement().clientWidth/2 - gmailComposeView._additionalAreas.groupedActionToolbarContainer.offsetWidth/2 - 3) + 'px';
		gmailComposeView._additionalAreas.groupedActionToolbarContainer.querySelectorAll('.inboxsdk__button')[0].focus();

		gmailComposeView.getElement().classList.add('inboxsdk__compose_groupedActionToolbar_visible');

		buttonViewController.getView().activate();
		localStorage['inboxsdk__compose_groupedActionButton_state'] = 'expanded';

		if(gmailComposeView.getFormattingToolbar().style.display === ''){
			simulateClick(gmailComposeView.getFormattingToolbarToggleButton());
		}
	}

	return !isExpanded;
}

function _swapToActionToolbar(gmailComposeView, buttonViewController){
	var actionToolbar = gmailComposeView.getElement().querySelector('.inboxsdk__compose_actionToolbar > div');
	var actionToolbarContainer = actionToolbar.parentElement;

	var newActionToolbar = document.createElement('div');
	newActionToolbar.appendChild(buttonViewController.getView().getElement());

	actionToolbarContainer.appendChild(newActionToolbar);
	gmailComposeView._additionalAreas.groupedActionToolbarContainer.appendChild(actionToolbar);
	actionToolbarContainer.appendChild(gmailComposeView._additionalAreas.groupedActionToolbarContainer);
}

function _checkAndSetInitialState(gmailComposeView, groupToggleButtonViewController){
	if(localStorage['inboxsdk__compose_groupedActionButton_state'] === 'expanded'){
		setTimeout(function(){ //do in timeout so that we wait for all buttons to get added
			groupToggleButtonViewController.activate();
		},1);
	}
}

function _startMonitoringFormattingToolbar(gmailComposeView, groupToggleButtonViewController){
	waitFor(function(){
		return !! gmailComposeView.getFormattingToolbar();
	}).then(function(){

		var mutationObserver = new MutationObserver(function(mutations){

			if(mutations[0].target.style.display === '' && localStorage['inboxsdk__compose_groupedActionButton_state'] === 'expanded'){
				groupToggleButtonViewController.activate();
			}

		});

		mutationObserver.observe(
			gmailComposeView.getFormattingToolbar(),
			{attributes: true, attributeFilter: ['style']}
		);

	});
}

module.exports = addButton;