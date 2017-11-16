import ProviderController from 'providers/provider-controller';
import { resolved } from 'polyfills/promise';
import getMediaElement from 'api/get-media-element';
import cancelable from 'utils/cancelable';
import MediaController from 'program/media-controller';

import { PLAYER_STATE, STATE_BUFFERING, STATE_IDLE } from 'events/events';

export default class ProgramController {
    constructor(model) {
        this.mediaController = null;
        this.model = model;
        this.providerController = ProviderController(model.getConfiguration());
        this.thenPlayPromise = cancelable(() => {});
        this.providerPromise = resolved;
    }

    setActiveItem(item, index) {
        const { mediaController, model } = this;
        this.thenPlayPromise.cancel();

        model.setActiveItem(item, index);

        const source = item && item.sources && item.sources[0];
        if (source === undefined) {
            // source is undefined when resetting index with empty playlist
            throw new Error('No media');
        }

        if (mediaController) {
            // Buffer between item switches, but remain in the initial state (IDLE) while loading the first provider
            model.set(PLAYER_STATE, STATE_BUFFERING);
            if (!this.providerController.canPlay(mediaController.provider, source)) {
                // If we can't play the source with the current provider, reset the current one and
                // prime the next tag within the gesture
                this._destroyActiveMedia();
            } else {
                // We can reuse the current mediaController
                // Reset it so that a play call before the providerPromise resolves doesn't cause problems
                // Any play calls will wait for the mediaController to setup again before calling play
                this.mediaController.reset();
            }
        }

        const mediaModelContext = model.mediaModel;
        this.providerPromise = this._loadProviderConstructor(source)
            .then((ProviderConstructor) => {
                // Don't do anything if we've tried to load another provider while this promise was resolving
                if (mediaModelContext === model.mediaModel) {
                    let nextProvider = mediaController && mediaController.provider;
                    // Make a new provider if we don't already have one
                    if (!nextProvider) {
                        nextProvider = new ProviderConstructor(model.get('id'), model.getConfiguration());
                        this._changeVideoProvider(nextProvider);
                    }
                    // Initialize the provider and mediaModel, sync it with the Model
                    // This sets up the mediaController and allows playback to begin
                    this.mediaController.init(item);

                    return Promise.resolve(this.mediaController);
                }
                return resolved;
            });
        return this.providerPromise;
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

        // Setup means that we've already started playback on the current item; all we need to do is resume it
        if (mediaController && mediaController.setup) {
            playPromise = mediaController.play(item, playReason);
        } else {
            // Wait for the provider to load before starting initial playback
            playPromise = this.providerPromise.then((nextMediaController) => {
                nextMediaController.play(item, playReason);
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
            mediaController.stop();
        } else {
            model.set(PLAYER_STATE, STATE_IDLE);
        }
    }

    preloadVideo() {
        const { mediaController, model } = this;
        if (!mediaController) {
            return;
        }

        const item = model.get('playlistItem');
        if (!item || (item && item.preload === 'none')) {
            return;
        }

        // Only attempt to preload if media hasn't been loaded and we haven't started
        if (model.get('state') === 'idle' && model.get('autostart') === false && !mediaController.setup) {
            mediaController.preload(item);
        }
    }

    pause() {
        const { mediaController } = this;
        if (!mediaController) {
            return;
        }

        mediaController.pause();
    }

    castVideo(castProvider, item) {
        this._changeVideoProvider(castProvider);
        this.mediaController.init(item);
    }

    stopCast() {
        this.stopVideo();
        this.mediaController = null;
    }

    _changeVideoProvider(nextProvider) {
        const { model } = this;
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

        this.mediaController = new MediaController(nextProvider, model);
    }

    _loadProviderConstructor(source) {
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

    _destroyActiveMedia() {
        const { model } = this;

        this.mediaController.destroy();
        this.mediaController = null;
        model.resetProvider();
        replaceMediaElement(model);
    }

    get audioTrack() {
        const { mediaController } = this;
        if (!mediaController) {
            return -1;
        }

        return mediaController.audioTrack;
    }

    get audioTracks() {
        const { mediaController } = this;
        if (!mediaController) {
            return;
        }

        return mediaController.getAudioTracks();
    }

    get activeProvider() {
        const { mediaController } = this;
        if (!mediaController) {
            return null;
        }

        return mediaController.provider;
    }

    get quality() {
        if (!this.mediaController) {
            return -1;
        }

        return this.mediaController.quality;
    }

    get qualities() {
        const { mediaController } = this;
        if (!mediaController) {
            return null;
        }

        return mediaController.qualities;
    }

    set audioTrack(index) {
        const { mediaController } = this;
        if (!mediaController) {
            return;
        }

        mediaController.audioTrack = parseInt(index, 10) || 0;
    }

    set controls(mode) {
        const { mediaController } = this;
        if (!mediaController) {
            return;
        }

        mediaController.controls = mode;
    }

    set position(pos) {
        const { mediaController } = this;
        if (!mediaController) {
            return;
        }

        mediaController.position = pos;
    }

    set quality(index) {
        const { mediaController } = this;
        if (!mediaController) {
            return;
        }

        mediaController.currentQuality = parseInt(index, 10) || 0;
    }

    set subtitles(index) {
        const { mediaController } = this;
        if (!mediaController) {
            return;
        }

        mediaController.subtitles = index;
    }
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


