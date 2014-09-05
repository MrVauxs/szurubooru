var App = App || {};
App.Presenters = App.Presenters || {};

App.Presenters.TopNavigationPresenter = function(
	jQuery,
	util,
	promise,
	auth) {

	var selectedElement = null;
	var $el = jQuery('#top-navigation');
	var template;

	function init() {
		promise.wait(util.promiseTemplate('top-navigation')).then(function(html) {
			template = _.template(html);
			render();
			auth.startObservingLoginChanges('top-navigation', loginStateChanged);
		});
	}

	function select(newSelectedElement) {
		selectedElement = newSelectedElement;
		$el.find('li').removeClass('active');
		$el.find('li.' + selectedElement).addClass('active');
	};

	function loginStateChanged() {
		render();
	}

	function render() {
		$el.html(template({
			loggedIn: auth.isLoggedIn(),
			user: auth.getCurrentUser(),
			canListUsers: auth.hasPrivilege('listUsers')
		}));
		$el.find('li.' + selectedElement).addClass('active');
	};

	return {
		init: init,
		render: render,
		select: select,
	};

};

App.DI.registerSingleton('topNavigationPresenter', App.Presenters.TopNavigationPresenter);
