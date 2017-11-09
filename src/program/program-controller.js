import Eventable from 'utils/eventable';
import ProviderController from 'providers/provider-controller';
import { resolved } from 'polyfills/promise';
import getMediaElement from 'api/get-media-element';
import { PROVIDER_CHANGED } from 'events/events';

export default class ProgramController extends Eventable {
    constructor(model) {
        super();

        this.activeProvider = null;
        this.model = model;
        this.providerController = ProviderController(model.getConfiguration());
    }

    setActiveItem(item) {
        const source = item && item.sources && item.sources[0];
        if (source === undefined) {
            // source is undefined when resetting index with empty playlist
            throw new Error('No media');
        }

        if (this.activeProvider && !this.providerController.canPlay(this.activeProvider, source)) {
            // If we can't play the source with the current provider, reset the current one and
            // prime the next tag within the gesture
            resetProvider(this.activeProvider, this.model);
            this.activeProvider = null;
            replaceMediaElement(this.model);
        }

        const mediaModelContext = this.model.mediaModel;
        return this.loadProviderConstructor(source)
            .then((ProviderConstructor) => {
                // Don't do anything if we've tried loading another provider while this.model promise was resolving
                if (mediaModelContext === this.model.mediaModel) {
                    let nextProvider = this.activeProvider;
                    if (!nextProvider) {
                        // We need to make a new provider
                        nextProvider = new ProviderConstructor(this.model.get('id'), this.model.getConfiguration());
                        return this.changeVideoProvider(nextProvider, item);
                    }
                    return this.setProvider(nextProvider, item);
                }
                return resolved;
            })
            .then(() => {
                // Listening for change:item won't suffice when loading the same index or file
                // We also can't listen for change:mediaModel because it triggers whether or not
                // an item was actually loaded
                return resolved;
            });
    }

    setProvider(nextProvider, item) {
        syncPlayerWithMediaModel(this.model.get('mediaModel'));
        // this allows the providers to preload
        if (nextProvider.init) {
            nextProvider.init(item);
        }

        // Set the Provider after calling init because some Provider properties are only set afterwards
        this.activeProvider = nextProvider;
        this.model.setProvider(nextProvider);
        this.trigger(PROVIDER_CHANGED, { nextProvider });

        return resolved;
    }

    changeVideoProvider(nextProvider, item) {
        this.model.off('change:mediaContainer', this.model.onMediaContainer);

        const container = this.model.get('mediaContainer');
        if (container) {
            nextProvider.setContainer(container);
        } else {
            this.model.once('change:mediaContainer', this.model.onMediaContainer);
        }

        // TODO: Split this into the mediaController
        nextProvider.on('all', this.model.videoEventHandler, this.model);
        // Attempt setting the playback rate to be the user selected value
        this.model.setPlaybackRate(this.model.get('defaultPlaybackRate'));
        this.providerController.sync(this.model, nextProvider);

        return this.setProvider(nextProvider, item);
    }

    loadProviderConstructor(source) {
        let ProviderConstructor = this.providerController.choose(source);
        if (ProviderConstructor) {
            return Promise.resolve(ProviderConstructor);
        }

        return this.providerController.loadProviders(this.model.get('playlist'))
            .then(() => {
                ProviderConstructor = this.providerController.choose(source);
                // The provider we need couldn't be loaded
                if (!ProviderConstructor) {
                    resetProvider(this.activeProvider, this.model);
                    this.activeProvider = null;
                    this.model.set('provider', undefined);
                    throw new Error('No providers for playlist');
                }
                return ProviderConstructor;
            });
    }
}

function syncPlayerWithMediaModel(mediaModel) {
    // Sync player state with mediaModel state
    const mediaState = mediaModel.get('state');
    mediaModel.trigger('change:state', mediaModel, mediaState, mediaState);
}

function replaceMediaElement(model) {
    // Replace click-to-play media element, and call .load() to unblock user-gesture to play requirement
    const lastMediaElement = model.attributes.mediaElement;
    const mediaElement =
        model.attributes.mediaElement = getMediaElement();
    mediaElement.volume = lastMediaElement.volume;
    mediaElement.muted = lastMediaElement.muted;
    mediaElement.load();
}

const resetProvider = (provider, model) => {
    if (provider) {
        provider.off(null, null, model);
        if (provider.getContainer()) {
            provider.remove();
        }
        delete provider.instreamMode;
    }
    model.resetProvider();
};
