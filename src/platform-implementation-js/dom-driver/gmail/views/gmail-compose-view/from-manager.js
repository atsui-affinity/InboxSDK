/* @flow */
//jshint ignore:start

const _ = require('lodash');
import simulateClick from '../../../../lib/dom/simulate-click';
import type GmailDriver from '../../gmail-driver';
import type GmailComposeView from '../../views/gmail-compose-view';

export function getFromContact(driver: GmailDriver, gmailComposeView: GmailComposeView): Contact {
  const nameInput: ?HTMLInputElement = (gmailComposeView.getElement().querySelector('input[name="from"]'):any);
  const emailAddress = nameInput ? nameInput.value : null;
  if (!emailAddress) {
    return driver.getUserContact();
  }
  const name = _.find(getFromContactChoices(driver, gmailComposeView),
    contact => contact.emailAddress == emailAddress).name;
  return {emailAddress, name};
}

export function getFromContactChoices(driver: GmailDriver, gmailComposeView: GmailComposeView): Contact[] {
  const choiceParent = gmailComposeView.getElement().querySelector('div.J-M.jQjAxd.J-M-awS[role=menu] > div.SK.AX');
  if (!choiceParent) {
    // From field isn't present
    return [driver.getUserContact()];
  }
  return _.map(choiceParent.children, item => ({
    emailAddress: item.getAttribute('value'),
    name: item.textContent.replace(/<.*/, '').trim()
  }));
}

export function setFromEmail(driver: GmailDriver, gmailComposeView: GmailComposeView, email: string) {
  let currentFromAddress = gmailComposeView.getFromContact().emailAddress;
  if(currentFromAddress === email){
    return;
  }

  const choiceParent = gmailComposeView.getElement().querySelector('div.J-M.jQjAxd.J-M-awS[role=menu] > div.SK.AX');
  if (!choiceParent) {
    if (driver.getUserContact().emailAddress != email) {
      throw new Error("Chosen email from choice was not found");
    }
    return;
  }
  const chosenChoice = _.find(choiceParent.children, item =>
    item.getAttribute('value') == email
  );
  if (!chosenChoice) {
    throw new Error("Chosen email from choice was not found");
  }
  simulateClick(chosenChoice);
}
