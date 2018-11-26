'use strict';

/**
 * Browserify
 */
var fs = require('fs');
var Handlebars = require('handlebars');

/**
* Marcom
*/
var BaseComponent = require("@marcom/ac-jetpack-lib/core/BaseComponent");
var querySelectorAll = require('@marcom/ac-dom-traversal/querySelectorAll');
var querySelector = require('@marcom/ac-dom-traversal/querySelector');
var ajax = require('@marcom/ac-ajax-xhr');
var consoleLog = require('@marcom/ac-console').log;
var acSolar = require('@marcom/ac-solar');
var classList = require('@marcom/ac-classlist');
var debounce = require('@marcom/ac-function/debounce');
var CircularTab = require('@marcom/ac-accessibility/CircularTab');

/**
* Newsroom
*/
var FilterBar = require('./FilterBar');
var Pagination = require('./Pagination');
var RouteManager = require('./RouteManager');
var Dropdown = require('./Dropdown');
var utils = require('../../helper/utils');
var setLocalStorageKey = require('../../helper/debugger').setKeyToGet;
var htmlToString = require('../../helper/htmlToString');

/**
* Constants
*/
Results.SELECTORS = {};
Results.SELECTORS.RESULT = 'result';
Results.SELECTORS.PAGE_TITLE = 'title';
Results.SELECTORS.RESULTS_CONTENT = 'results__content';
Results.SELECTORS.RESULTS_ITEM = 'result__item';
Results.SELECTORS.LOADING_MODAL = 'loading-container';

Results.REGEXP = {};
Results.REGEXP.ENVS = /(^ic[0-9]{2}(-dev|-local)?).apple.com/;
Results.REGEXP.LAST_SLASH = /\/$/;

Results.TIMERS = {};
Results.TIMERS.SCROLL = 0;
Results.TIMERS.SCROLL_DELAY = 0;

Results.STATE_KEYS = {};
Results.STATE_KEYS.FILTER = 'filter';
Results.STATE_KEYS.PAGINATION = 'pagination';

Results.STATE_LOADING = 'results-loading';
Results.STATE_RENDERING = 'results-rendering';

Results.RENDERING_DELAY = 700;
Results.CONTENT_REQUEST_TIMEOUT = 5000;

Results.getTestingUrl = setLocalStorageKey('4c8e99dc-60b2-4511-9df1-4086bb08d560');

/**
 * Results Module
 *
 * @class
 * @constructor
 * @param {Element} node element representing the results container
*/
function Results() {
	BaseComponent.apply(this, arguments);

	this.filterBar = this.section.getComponentOfType('FilterBar');
	this.pagination = this.section.getComponentOfType('Pagination');
	this.loadingModal = new CircularTab(querySelector('.'+Results.SELECTORS.LOADING_MODAL));

	this.state = this.setInitialState();

	this.pageTitle = querySelector(Results.SELECTORS.PAGE_TITLE);
	this.results = querySelectorAll('.'+Results.SELECTORS.RESULT);
	this.resultsContent = querySelector('.'+Results.SELECTORS.RESULTS_CONTENT);
	this.resultsTemplate = this.handlebarsSetup();

	this.routeManager = new RouteManager(
		this.generateRelativeBaseUrl(),
		this.updateStateAndRequestContent.bind(this)
	);
	this.currentRequest = null;
	this.html = querySelector('html');

	window.history.replaceState(
		this.state,
		utils.slugify(window.location.pathname + window.location.search),
		window.location.pathname + window.location.search
	);
}

var proto = Results.prototype = Object.create(BaseComponent.prototype);
Results.prototype.constructor = Results;

/**
 * Sets initial state for filtering and pagination criteria.
 *
 * @returns {{filter: {}, pagination: {}}}
 */
proto.setInitialState = function () {
	var filterData = this.filterBar.state || {};

	return {
		filter: {
			isInitial: true,
			data: filterData
		},
		pagination: {
			isInitial: true,
			data: {
				current: Number(document.querySelector('.pagination-ctrl__info--current').textContent),
				total: Number(document.querySelector('.pagination-ctrl__info--total').textContent),
				lastAction: null
			}
		}
	};
};

/**
* Setup general events
* @return {void}
*/
proto.setupEvents = function () {
	this.section.on(
		FilterBar.EVENTS.STATE_CHANGE,
		this.handleStateChange(
			Results.STATE_KEYS.FILTER
		)
	);
	this.section.on(
		Pagination.EVENTS.STATE_CHANGE,
		this.handleStateChange(
			Results.STATE_KEYS.PAGINATION
		)
	);
};

/**
 * Updates current state, from filter and pagination states, then executes the according
 * content update.
 *
 * @param key
 * @returns {function (this:Results)}
 */
proto.handleStateChange = function (key) {
	return function (state) {
		this.state[key] = state;
		consoleLog(key, this.state);

		// Reset pagination on filter changes,
		// the execution of content update is prevented,
		// until pagination gets updated.
		if (key === Results.STATE_KEYS.FILTER) {
			this.section.trigger(Pagination.EVENTS.RESET_STATE);
			return;
		}

		this.executeContentUpdate();
	}.bind(this);
};

/**
 * Executes all task associated with a retrieving and showing
 * new content results on the page.
 */
proto.executeContentUpdate = function () {
	this.setPageUrl();
	this.manageContentUpdate();
};

/**
 * Changes page url accordingly to filtering and pagination state.
 */
proto.setPageUrl = function () {
	var url = this.getUrlState();

	this.routeManager.setPageUrl(url, this.state);
};

/**
 * Updates component state, before sending a content update request
 * @param state
 */
proto.updateStateAndRequestContent = function (state) {
	var Pagination = this.section.getComponentOfType('Pagination');

	if (state) {
		this.state = state;
	}

	this.filterBar.updateSelectedOptions(this.state.filter);
	Pagination.setPaginationState(this.state.pagination);

	this.manageContentUpdate();
};

/**
 * Determines current page url, by matching current filtering and pagination criteria.
 * Then it returns and object which describes URL state.
 *
 * @returns {{url: string, segments: (Array|*|{annotation}|Object)}}
 */
proto.getUrlState = function () {
	var currentPage = this.state[Results.STATE_KEYS.PAGINATION].data.current || Pagination.FIRST_PAGE;
	var withPagination = currentPage !== Pagination.FIRST_PAGE;
	var include = {
		year: this.state[Results.STATE_KEYS.FILTER].data.year !== Dropdown.DEFAULT_FILTER_ID,
		month: this.state[Results.STATE_KEYS.FILTER].data.month !== Dropdown.DEFAULT_FILTER_ID,
		topic: this.state[Results.STATE_KEYS.FILTER].data.topic !== Dropdown.DEFAULT_FILTER_ID,
		page: withPagination && currentPage !== Pagination.FIRST_PAGE
	};
	var segments = {
		year: {
			valid: include.year,
			value: this.state[Results.STATE_KEYS.FILTER].data.year
		},
		month: {
			valid: include.month,
			value: this.state[Results.STATE_KEYS.FILTER].data.month
		},
		topic: {
			valid: include.topic,
			value: this.state[Results.STATE_KEYS.FILTER].data.topic
		},
		page: {
			valid: include.page,
			value: '?page=' + currentPage
		}
	};

	return this.constructUrl(segments, !include.page);
};

/**
 * Returns an url from given pieces
 *
 * @param {Array} segments url parameters
 * @param {Boolean} withTrailingSlash include or not end slash
 * @returns {string}
 */
proto.constructUrl = function (segments, withTrailingSlash) {
	var trailingSlash = withTrailingSlash ? '/' : '';
	var url = Object.keys(segments)
		.filter(function (key) {
			return segments.hasOwnProperty(key) && segments[key].valid
		})
		.map(function (key) {
			return segments[key].value;
		});

	return url.join('/') + trailingSlash;
};

/**
 * Manage how to execute a content update
 */
proto.manageContentUpdate = function () {
	var endpointURL = Results.getTestingUrl();

	// Content updates will be requested from external endpoint on: ic53 and dev environments,
	// otherwise, endpoint will be relatively to the sever.
	var isDevOrIc53Env = Results.REGEXP.ENVS.test(window.location.host);
	var runFakeCall = isDevOrIc53Env && !endpointURL;
	var host = endpointURL
		? endpointURL + window.location.pathname
		: window.location.pathname;
	this.show(Results.STATE_LOADING, true);
	this.loadingModal.start();

	if (runFakeCall) {
		consoleLog('Requesting fake content update');
		this.requestFakeContentUpdate();
	} else {
		consoleLog('Requesting content update from: ' + endpointURL);
		this.requestContentUpdate(host);
	}
};

/**
 * Executes a request to the data provider services, to return
 * updated content results
 *
 * @param host {String}
 * return {void}
 */
proto.requestContentUpdate = function (host) {
	var queryParams = window.location.search;

	host = host.replace(Results.REGEXP.LAST_SLASH, '');
	var requestUrl = host + '.json' + queryParams;

	this.cancelableGetRequest(
		requestUrl, {
			error: function (xhr, status) {
				consoleLog('xhr.readyState:', xhr.readyState);
				consoleLog('Error, status:', status);
			}.bind(this),
			success: function (data, status, xhr) {
				consoleLog('Success, status:', status);
				consoleLog('xhr:', xhr);
				consoleLog('Data:', JSON.parse(data));
				this.renderResults(JSON.parse(data));
			}.bind(this),
			timeout: Results.CONTENT_REQUEST_TIMEOUT
		}
	);
};

/**
 * Executes a content update based on a mock response
 * from an static json file.
 */
proto.requestFakeContentUpdate = function() {
	var requestTimeout = 300;
	var mock = Results.MOCK_DATA;
	var data = {
		totalPages: mock.filter.totalPages,
		results: mock.results
	};
	var defaultId = 'filter';
	var checkedId = function (id) {
		return id && mock.hasOwnProperty(id) ? id : defaultId;
	};
	var params = this.getUrlState().split('/');
	var mergeMock = params.length > 1;

	if (mergeMock) {
		var filterState = [];

		params.forEach(function (param) {
			var id = checkedId(param);
			var dropdowns = mock[id].filterState;

			dropdowns.forEach(function (dropdown, idx) {
				var temp = filterState[idx] ? filterState[idx].disabledOptions : [];

				filterState[idx] = {
					id: dropdown.id,
					disabledOptions: utils.uniqueArrayMerge(dropdown.disabledOptions, temp)
				};
			});
		});

		data.totalPages = mock[defaultId].totalPages;
		data.filterState = filterState;
	} else  {
		var id = checkedId(params[0]);
		data.filterState = mock[id].filterState;
	}

 	data.results = utils.arrayShuffle(data.results);
	setTimeout(function() {
		this.renderResults(data);
	}.bind(this), requestTimeout);
};

/**
 * Content update request handler
 *
 * @param url
 * @param config
 * @returns {null}
 */
proto.cancelableGetRequest = function (url, config) {
	if (this.currentRequest) {
		this.currentRequest.xhr.abort();
	}

	config.complete = function () {
		this.currentRequest = null;
	}.bind(this);

	this.currentRequest = ajax.get(url, config);

	return this.currentRequest;
};

/**
 * Attach new content results to the DOM element.
 */
proto.renderResults = function (data) {
	var debouncedFinishRendering = debounce(this._afterRenderAnimation.bind(this, data), Results.RENDERING_DELAY);

	this.show(Results.STATE_LOADING, false);
	this.show(Results.STATE_RENDERING, true);
	debouncedFinishRendering();
};

/**
 * Process after `Results.RENDERING_DELAY` miliseconds from rendering
 */
proto._afterRenderAnimation = function(data) {
	var pagination = this.section.getComponentOfType('Pagination');

	this.pageTitle.text = data.title || this.pageTitle.text;
	this.resultsContent.innerHTML = this.resultsTemplate(data);
	this.filterBar.updateDisabledOptions(data.filterState);

	this.state.pagination.data.total = data.totalPages;
	pagination.setPaginationState(this.state.pagination);

	Results.analytics.onClick(this.state);
	this.show(Results.STATE_RENDERING, false);
	this.loadingModal.stop();

	this.scrollToTop(Results.TIMERS.SCROLL, Results.TIMERS.SCROLL_DELAY)
	if (this.state[Results.STATE_KEYS.PAGINATION].data.lastAction !== Pagination.ACTIONS.RESET) {
		this.focusFirstArticle();
	} else {
		this.filterBar.trigger(FilterBar.EVENTS.ACTIVE_FOCUSED);
	}
}

/**
 * Using the current pathname and expected base-path generate a relative
 * base url.
 *
 * @return {String} relative base url
 */
proto.generateRelativeBaseUrl = function () {
	var pathName = window.location.pathname;
	var basePath = Results.URL_SEGMENT;
	var sliceIndex = pathName.indexOf(basePath) + basePath.length;

	return pathName.slice(0, sliceIndex);
};

/**
 * Focus first article in results
 *
 * @return void
 */
proto.focusFirstArticle = function () {
	querySelector('.' + Results.SELECTORS.RESULTS_ITEM, this.resultsContent).focus();
};

proto.handlebarsSetup = function () {
	Handlebars.registerHelper({
		htmlToString: htmlToString
	});
	return Handlebars.compile(Results.RESULTS_TEMPLATE);
};

/**
 * Executes a linear scroll to top animation
 *
 * @param {Number} duration time in milliseconds
 * @param {Number|undefined} delay animation time
 */
proto.scrollToTop = function (duration, delay, selectFirstTile) {
	acSolar.scrollY(window, 0, duration, { delay: delay });
};

proto.show = function (state, show) {
	if (show) {
		classList.add(this.section.element, state);
	}
	else {
		classList.remove(this.section.element, state);
	}
};

module.exports = Results;
