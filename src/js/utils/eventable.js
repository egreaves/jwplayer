import BackboneEvents from 'os/utils/backbone.events';

export default class Eventable {}
Eventable.prototype = Object.assign({}, BackboneEvents);