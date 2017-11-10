import Eventable from 'utils/eventable';
import ProviderController from 'providers/provider-controller';
import { resolved } from 'polyfills/promise';
import getMediaElement from 'api/get-media-element';
import cancelable from 'utils/cancelable';
import MediaController from 'program/media-controller';

import { ERROR, MEDIA_PLAY_ATTEMPT, MEDIA_PLAY_ATTEMPT_FAILED, PLAYER_STATE, STATE_PAUSED, STATE_BUFFERING } from 'events/events';

export default class ProgramController extends Eventable {
    constructor(model) {
        super();

        this.activeProvider = null;
        this.model = model;
        this.providerController = ProviderController(model.getConfiguration());
        this.thenPlayPromise = cancelable(() => {});
        // The providerPromise will resolve with undefined or the active provider
        this.providerPromise = resolved;
        this.mediaController = null;
    }

    setActiveItem(item) {
        this.thenPlayPromise.cancel();

        const model = this.model;
        model.setActiveItem(item);
        model.resetItem(item);

        const source = item && item.sources && item.sources[0];
        if (source === undefined) {
            // source is undefined when resetting index with empty playlist
            throw new Error('No media');
        }

        if (this.activeProvider && !this.providerController.canPlay(this.activeProvider, source)) {
            // If we can't play the source with the current provider, reset the current one and
            // prime the next tag within the gesture
            resetProvider(this.activeProvider, model);
            this.activeProvider = null;
            replaceMediaElement(model);
            model.set(PLAYER_STATE, STATE_BUFFERING);
            this.mediaController = null;
        }

        const mediaModelContext = model.mediaModel;
        this.providerPromise = this.loadProviderConstructor(source)
            .then((ProviderConstructor) => {
                // Don't do anything if we've tried loading another provider while the load promise was resolving
                if (mediaModelContext === model.mediaModel) {
                    let nextProvider = this.activeProvider;
                    if (!nextProvider) {
                        // We need to make a new provider
                        nextProvider = new ProviderConstructor(model.get('id'), model.getConfiguration());
                        this.changeVideoProvider(nextProvider);
                    }
                    this.setProvider(nextProvider, item);
                    return Promise.resolve(this.activeProvider);
                }
                return resolved;
            })
            .then(nextProvider => {
                if (!this.mediaController) {
                    this.mediaController = new MediaController(nextProvider, model);
                }
                this.mediaController.init();
                model.setMediaModel(this.mediaController.mediaModel);
                return this.mediaController;
            });

        return this.providerPromise;
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
    }

    changeVideoProvider(nextProvider) {
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

    playVideo(playReason) {
        const model = this.model;
        const mediaController = this.mediaController;
        const item = model.get('playlistItem');
        let playPromise;

        if (!item) {
            return;
        }

        if (!playReason) {
            playReason = model.get('playReason');
        }

        if (mediaController && mediaController.setup) {
            mediaController.playVideo(item, playReason);
        } else {
            playPromise = this.providerPromise.then((nextMediaController) => {
                nextMediaController.playVideo(item, playReason);
            });
        }

        return playPromise;
    }

    _playVideo(playReason) {
        const model = this.model;
        const activeProvider = this.activeProvider;
        let playPromise;

        const item = model.get('playlistItem');
        if (!item) {
            return;
        }

        if (!playReason) {
            playReason = model.get('playReason');
        }

        model.set('playRejected', false);
        if (!model.mediaModel.get('setup')) {
            playPromise = loadAndPlay(model, item, this.thenPlayPromise, this.providerPromise, activeProvider);
            playAttempt(model, playPromise, playReason, activeProvider);
        } else {
            playPromise = activeProvider.play() || resolved;
            if (!model.mediaModel.get('started')) {
                playAttempt(model, playPromise, playReason, activeProvider);
            }
        }
        return playPromise;
    }

    stopVideo() {
        this.thenPlayPromise.cancel();

        const model = this.model;
        const item = model.get('playlist')[model.get('item')];

        model.attributes.playlistItem = item;
        model.resetItem(item);
        if (this.activeProvider) {
            this.activeProvider.stop();
        }
    }

    preloadVideo() {
        const model = this.model;
        // TODO: attach/detach logic
        let _attached = false;
        const item = model.get('playlistItem');
        // Only attempt to preload if media is attached and hasn't been loaded
        if (model.get('state') === 'idle' && _attached && model.activeProvider &&
            item.preload !== 'none' &&
            model.get('autostart') === false &&
            !model.mediaModel.get('setup') &&
            !model.mediaModel.get('preloaded')) {
            model.mediaModel.set('preloaded', true);
            this.activeProvider.preload(item);
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


function loadAndPlay(model, item, thenPlayPromise, providerPromise, provider) {
    thenPlayPromise.cancel();

    const mediaModelContext = model.mediaModel;
    if (provider) {
        return playWithProvider(item, provider, thenPlayPromise);
    }

    mediaModelContext.set('setup', true);

    thenPlayPromise = cancelable((activeProvider) => {
        if (mediaModelContext === model.mediaModel) {
            return playWithProvider(item, activeProvider, thenPlayPromise);
        }
        throw new Error('Playback cancelled.');
    });

    return providerPromise.catch(error => {
        thenPlayPromise.cancel();
        // Required provider was not loaded
        model.trigger(ERROR, {
            message: `Could not play video: ${error.message}`,
            error: error
        });
        // Fail the playPromise to trigger "playAttemptFailed"
        throw error;
    }).then(thenPlayPromise.async);
}

function playWithProvider(item, provider, thenPlayPromise) {
    // Calling load() on Shaka may return a player setup promise
    const providerSetupPromise = provider.load(item);
    if (providerSetupPromise) {
        thenPlayPromise = cancelable(() => {
            return provider.play() || resolved;
        });
        return providerSetupPromise.then(thenPlayPromise.async);
    }
    return provider.play() || resolved;
}

function playAttempt(model, playPromise, playReason, provider) {
    const mediaModelContext = model.mediaModel;
    const itemContext = model.get('playlistItem');

    model.mediaController.trigger(MEDIA_PLAY_ATTEMPT, {
        item: itemContext,
        playReason: playReason
    });

    // Immediately set player state to buffering if these conditions are met
    const videoTagUnpaused = provider && provider.video && !provider.video.paused;
    if (videoTagUnpaused) {
        model.set(PLAYER_STATE, STATE_BUFFERING);
    }

    playPromise.then(() => {
        if (!mediaModelContext.get('setup')) {
            // Exit if model state was reset
            return;
        }
        mediaModelContext.set('started', true);
        if (mediaModelContext === model.mediaModel) {
            syncPlayerWithMediaModel(mediaModelContext);
        }
    }).catch(error => {
        model.set('playRejected', true);
        const videoTagPaused = provider && provider.video && provider.video.paused;
        if (videoTagPaused) {
            mediaModelContext.set(PLAYER_STATE, STATE_PAUSED);
        }
        model.mediaController.trigger(MEDIA_PLAY_ATTEMPT_FAILED, {
            error: error,
            item: itemContext,
            playReason: playReason
        });
    });
}

