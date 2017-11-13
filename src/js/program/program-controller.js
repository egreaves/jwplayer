import Eventable from 'utils/eventable';
import ProviderController from 'providers/provider-controller';
import { resolved } from 'polyfills/promise';
import getMediaElement from 'api/get-media-element';
import cancelable from 'utils/cancelable';
import MediaController from 'program/media-controller';

import { PLAYER_STATE, STATE_BUFFERING } from 'events/events';

export default class ProgramController extends Eventable {
    constructor(model) {
        super();

        this.mediaController = null;
        this.model = model;
        this.providerController = ProviderController(model.getConfiguration());
        this.thenPlayPromise = cancelable(() => {});
        this.providerPromise = resolved;
    }

    setActiveItem(item) {
        const { mediaController, model } = this;
        this.thenPlayPromise.cancel();

        model.setActiveItem(item);
        model.resetItem(item);

        const source = item && item.sources && item.sources[0];
        if (source === undefined) {
            // source is undefined when resetting index with empty playlist
            throw new Error('No media');
        }

        if (mediaController && !this.providerController.canPlay(mediaController.provider, source)) {
            // If we can't play the source with the current provider, reset the current one and
            // prime the next tag within the gesture
            this.mediaController.destroy();
            this.mediaController = null;
            model.resetProvider();
            model.set(PLAYER_STATE, STATE_BUFFERING);
            replaceMediaElement(model);
        }

        const mediaModelContext = model.mediaModel;
        this.providerPromise = this.loadProviderConstructor(source)
            .then((ProviderConstructor) => {
                // Don't do anything if we've tried to load another provider while this promise was resolving
                if (mediaModelContext === model.mediaModel) {
                    let nextProvider = mediaController && mediaController.provider;
                    // Make a new provider if we don't already have one
                    if (!nextProvider) {
                        nextProvider = new ProviderConstructor(model.get('id'), model.getConfiguration());
                        this.changeVideoProvider(nextProvider);
                        this.mediaController = new MediaController(nextProvider, model);
                    }
                    // Initialize the provider and mediaModel, sync it with the Model
                    this.model.setProvider(nextProvider);
                    this.mediaController.init(item);
                    model.setMediaModel(this.mediaController.mediaModel);
                    syncPlayerWithMediaModel(this.model.get('mediaModel'));

                    return Promise.resolve(this.mediaController);
                }
                return resolved;
            });
        return this.providerPromise;
    }

    changeVideoProvider(nextProvider) {
        const { model, providerController } = this;
        model.off('change:mediaContainer', model.onMediaContainer);

        const container = model.get('mediaContainer');
        if (container) {
            nextProvider.setContainer(container);
        } else {
            model.once('change:mediaContainer', model.onMediaContainer);
        }

        // TODO: Split into the mediaController
        nextProvider.on('all', model.videoEventHandler, model);
        // Attempt setting the playback rate to be the user selected value
        model.setPlaybackRate(model.get('defaultPlaybackRate'));
        providerController.sync(model, nextProvider);
    }

    loadProviderConstructor(source) {
        const { model, mediaController, providerController } = this;

        let ProviderConstructor = providerController.choose(source);
        if (ProviderConstructor) {
            return Promise.resolve(ProviderConstructor);
        }

        return providerController.loadProviders(model.get('playlist'))
            .then(() => {
                ProviderConstructor = providerController.choose(source);
                // The provider we need couldn't be loaded
                if (!ProviderConstructor) {
                    if (mediaController) {
                        mediaController.destroy();
                        model.resetProvider();
                        this.mediaController = null;
                    }
                    model.set('provider', undefined);
                    throw new Error('No providers for playlist');
                }
                return ProviderConstructor;
            });
    }

    playVideo(playReason) {
        const { mediaController, model } = this;
        const item = model.get('playlistItem');
        let playPromise;

        if (!item) {
            return;
        }

        if (!playReason) {
            playReason = model.get('playReason');
        }

        if (mediaController && mediaController.setup) {
            playPromise = mediaController.playVideo(item, playReason);
        } else {
            playPromise = this.providerPromise.then((nextMediaController) => {
                nextMediaController.playVideo(item, playReason);
            });
        }

        return playPromise;
    }

    stopVideo() {
        const { mediaController, model } = this;
        this.thenPlayPromise.cancel();

        const item = model.get('playlist')[model.get('item')];
        model.attributes.playlistItem = item;
        model.resetItem(item);

        if (mediaController) {
            mediaController.stopVideo();
        }
    }

    preloadVideo() {
        const { mediaController, model } = this;
        if (!mediaController) {
            return;
        }
        // TODO: attach/detach logic
        // let _attached = false;
        const item = model.get('playlistItem');
        // Only attempt to preload if media is attached and hasn't been loaded
        if (model.get('state') === 'idle' &&
            item.preload !== 'none' &&
            model.get('autostart') === false &&
            !mediaController.setup &&
            !mediaController.preloaded) {
            mediaController.preloadVideo(item);
        }
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


