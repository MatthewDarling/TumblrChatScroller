// ==UserScript==
// @name Tumblr Chat Scroller
// @author Matthew Darling
// @namespace Violentmonkey Scripts
// @match *://www.tumblr.com/blog/*/activity
// @grant none
// @require https://raw.githubusercontent.com/moment/moment/2.22.2/moment.js
// @require https://raw.githubusercontent.com/jsmreese/moment-duration-format/2.2.2/lib/moment-duration-format.js
// ==/UserScript==

/* General maintenance notes:
   + XPath seems to behave better than CSS Paths, but it may have
   issues outside Firefox. Consider
   https://github.com/google/wicked-good-xpath
*/

// Shared purpose vars
var shouldBeScrolling = false;
var baseSelector = "[class^='dashboard-context'] [id^='activity_actions_index'] ";

// Stuff for dealing with the messages
var baseXPath = "/html[starts-with(@class, 'dashboard')]/body[starts-with(@id, 'activity_actions_index')]";
var conversationXPath = baseXPath + "/div[starts-with(@class, 'messaging-conversation-popovers')]/div[starts-with(@class, 'messaging-conversations-container')]/div[starts-with(@class, 'popover')]/div[@class='messaging-conversation-wrapper']/div[starts-with(@class, 'messaging-conversation')]/div[@class='conversation-main']";
var loadingIndicatorXPath = conversationXPath + "/div[@style='display: none;' and @class='knight-rider-container']";
var messageBoxXPath = conversationXPath + "/div[@class='tx-scroll']/div[starts-with(@class, 'conversation-messages')]";
var timestampXPath = messageBoxXPath + "/div[@class='message-list']/div[@class='conversation-message']/div[@class='conversation-message-timestamp']/div[@class='inline-activity timestamp']";

// Stuff for placing the activation button
var headerSelector = baseSelector + "[class^='l-header-container'] [class^='l-header'] ";
var headerToolbarSelector = headerSelector + "[id^='tabs_outer_container'] [id^='user_tools'] ";
var dashboardButtonSelector = headerToolbarSelector + "[id^='home_button']";

var myButtonStyle = "style='padding-top: 2%; cursor: pointer;'";

var scrollButtonID = "my_custom_scroll_button";
var scrollButtonSelector = headerToolbarSelector + "[id='" + scrollButtonID + "']";
var scrollButtonHTML = "<div class='tab iconic tab_home ' id=" + scrollButtonID + " " + myButtonStyle + "><span>Scroll</span></div>";

var scrollButton = htmlToElement(scrollButtonHTML);
scrollButton.onclick = function() { runScript(); shouldBeScrolling = true; };

class Queue {
    constructor(maxSize) {
        this.storage = [];
        this.maxSize = maxSize;
    }

    get size() {
        return this.storage.length;
    }

    get queueFull() {
        return this.size === this.maxSize;
    }

    dequeue() {
        return this.storage.shift();
    }

    enqueue(data) {
        if (this.queueFull) {
            this.dequeue();
        }
        return this.storage.push(data);
    }

    allEqual() {
        return this.storage.every( (val, i, arr) => val === arr[0] );
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function tumblrDateConvert(tumblrDateString) {
    return moment(tumblrDateString, "MM/DD/YYYY");
}

function formattedDiff(laterTime, earlierTime) {
    var ms = laterTime.diff(earlierTime);
    var d = moment.duration(ms);
    return d.format("hh[h]:mm[m]:ss[s]");
}

// From: https://stackoverflow.com/a/35385518
function htmlToElement(html) {
    var template = document.createElement('template');
    html = html.trim(); // Never return a text node of whitespace as the result
    template.innerHTML = html;
    return template.content.firstChild;
}

function insertBefore(elem, newNode) {
    elem.parentNode.insertBefore(newNode, elem);
}

function doScrollAndLog(elem, scrollHistory) {
    scrollHistory.enqueue(elem.scrollHeight);
    elem.scrollTop = 0;
}

function earliestTimestamp() {
    var result = document.evaluate(timestampXPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);

    if (result.invalidIteratorState || result.singleNodeValue === null) {
        return null;
    }
    return result.singleNodeValue.textContent;
}

async function finishLoading() {
    var result = document.evaluate(loadingIndicatorXPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);

    while (shouldBeScrolling && (result.invalidIteratorState || result.singleNodeValue === null || !earliestTimestamp())) {
        await sleep(100);
        console.log("Still loading messages, will check again in 100 milliseconds");
        result = document.evaluate(loadingIndicatorXPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    }
}

async function scrollMessagesTo(targetDateString) {
    var start = moment();
    var scrollPosHistory = new Queue(3);
    var stuckCounter = 0;
    // convert the target date once, and reuse during each loop
    var targetDate = tumblrDateConvert(targetDateString);
    var tumblrMessagesElem = document.evaluate(messageBoxXPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;

    if (tumblrMessagesElem == null) {
        // the selector for the message box can fail if the page has just been opened
        // this seems fixed now that I use class^= in the selector though...
        // guess it was related to the "input-type" thing they do
        window.alert("Please click into the message box, then try again");
        return null;
    }

    if (tumblrDateConvert(earliestTimestamp() >= targetDate)) {
        window.alert("You're already there, yay!");
        return null;
    }

    // loop and a half so that it starts right away
    doScrollAndLog(tumblrMessagesElem, scrollPosHistory);

    do {
        // sleep at start of loop, so that the end of the loop isn't delayed
        await sleep(2000);

        doScrollAndLog(tumblrMessagesElem, scrollPosHistory);
        await finishLoading();

        if (scrollPosHistory.queueFull && scrollPosHistory.allEqual()) {
            var approxTimeForLog = earliestTimestamp() || "unknown time";
            console.log("Detected stuck scrolling around " + approxTimeForLog + ", scrolling down temporarily");

            stuckCounter += 1;
            tumblrMessagesElem.scrollTop = tumblrMessagesElem.scrollHeight;
            await sleep(1000);

            doScrollAndLog(tumblrMessagesElem, scrollPosHistory);
        }
    } while (shouldBeScrolling &&
             (tumblrDateConvert(earliestTimestamp()) >= targetDate));

    // move near the top for some visual indication that the scroll has finished
    tumblrMessagesElem.scrollTop = 50;

    var end = moment();
    window.alert("Done scrolling!!!!!!!!!!\n\nGot stuck " +
                 stuckCounter +
                 " times\n\n" +
                 "Time spent scrolling:\n    " +
                 formattedDiff(end, start));
}

async function runScript() {
    while (document.querySelector(messageBoxSelector) === null) {
        await sleep(1000);
    }

    var input = window.prompt("What date should we scroll to? (MM/DD/YYYY)", "");

    if (input !== null) {
        scrollMessagesTo(input);
    }
}

async function addMyButton() {
    while (document.querySelector(dashboardButtonSelector) === null) {
        await sleep(1000);
    }

    insertBefore(document.querySelector(dashboardButtonSelector), scrollButton);
}

function stopScrollWithF1(event) {
    // Reference for keycodes: https://unixpapa.com/js/key.html
    if (event.keyCode === 112 && shouldBeScrolling) {
        shouldBeScrolling = false;
    }
}

window.addEventListener ("load", addMyButton);
document.addEventListener('keydown', stopScrollWithF1, false);

/* Code scratchpad

// Stuff for avatar processing - may add a feature to remove avatars
// from chat, no need to back up thousands of copies of the same thing
var conversationSelector = baseSelector + "[class^='messaging-conversation-popovers'] [class^='messaging-conversations-container'] [class^='popover'] [class='messaging-conversation-wrapper'] [class^='messaging-conversation'] [class='conversation-main'] [class='tx-scroll'] ";
var messageBoxSelector = conversationSelector + "[class^='conversation-messages'] ";
var sharedPostAvatarSelector = messageBoxSelector + " div.message-list div.conversation-message div [class^='conversation-message'] [class^='message-container'] [class^='avatar']"
var textMessageAvatarSelector = messageBoxSelector + " div.message-list div.conversation-message div [class^='conversation-message'] [class^='avatar']"

function avatarToText(avatarElem) {
// Note for future self: sometimes text posts fail the .firstChild part

// Follow-up from slightly future self: CSS Paths didn't support
// optional elements, but XPath might
// So that could unify the text vs shared post dilemma

avatarElem.outerHTML = "<div>" +
avatarElem.firstChild.getAttribute("data-js-tumblelog-name") +
": </div>";
}

function removeAvatars(avatarSelector) {
document.querySelectorAll(avatarSelector).forEach(avatarToText);
}
*/
