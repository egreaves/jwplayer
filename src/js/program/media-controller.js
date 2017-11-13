import cancelable from 'utils/cancelable';
import { resolved } from 'polyfills/promise';
import SimpleModel from 'model/simplemodel';
import { seconds } from 'utils/strings';

import { MEDIA_PLAY_ATTEMPT, MEDIA_PLAY_ATTEMPT_FAILED, PLAYER_STATE,
    STATE_PAUSED, STATE_BUFFERING, STATE_IDLE } from 'events/events';

export default class MediaController {
    constructor(provider, model) {
        this.provider = provider;
        this.model = model;
        this.mediaModel = null;
    }

    init(item) {
        this.provider.init(item);
        const mediaModel = this.mediaModel = new MediaModel();
        const position = item ? seconds(item.starttime) : 0;
        const duration = item ? seconds(item.duration) : 0;
        const mediaModelState = mediaModel.attributes;
        mediaModel.srcReset();
        mediaModelState.position = position;
        mediaModelState.duration = duration;
    }

    reset() {
        this.mediaModel = null;
    }

    playVideo(item, playReason) {
        const { model, mediaModel, provider } = this;

        if (!playReason) {
            playReason = model.get('playReason');
        }

        model.set('playRejected', false);
        let playPromise = resolved;
        if (mediaModel.get('setup')) {
            playPromise = provider.play();
        } else {
            playPromise = loadAndPlay(item, provider);
            mediaModel.set('setup', true);
            if (!mediaModel.get('started')) {
                playAttempt(playPromise, model, playReason, provider);
            }
        }
        return playPromise;
    }

    stopVideo() {
        this.provider.stop();
    }

    preloadVideo(item) {
        const { mediaModel, provider } = this;
        if (this.preloaded) {
            return;
        }

        provider.preload(item);
        mediaModel.set('preloaded', true);
    }

    destroy() {
        const { provider, model } = this;

        provider.off(null, null, model);
        if (provider.getContainer()) {
            provider.remove();
        }
        delete provider.instreamMode;
        this.provider = null;
    }

    get setup() {
        return this.mediaModel.get('setup');
    }

    get preloaded() {
        return this.mediaModel.get('preloaded');
    }
}

function loadAndPlay(item, provider) {
    // Calling load() on Shaka may return a player setup promise
    const providerSetupPromise = provider.load(item);
    if (providerSetupPromise) {
        const thenPlayPromise = cancelable(() => {
            return provider.play() || resolved;
        });
        return providerSetupPromise.then(thenPlayPromise.async);
    }
    return provider.play() || resolved;
}

// Executes the playPromise
function playAttempt(playPromise, model, playReason, provider) {
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

function syncPlayerWithMediaModel(mediaModel) {
    // Sync player state with mediaModel state
    const mediaState = mediaModel.get('state');
    mediaModel.trigger('change:state', mediaModel, mediaState, mediaState);
}

// Represents the state of the provider/media element
const MediaModel = function() {
    this.attributes = {
        state: STATE_IDLE
    };
};

Object.assign(MediaModel.prototype, SimpleModel, {
    srcReset() {
        const attributes = this.attributes;
        attributes.setup = false;
        attributes.started = false;
        attributes.preloaded = false;
        attributes.visualQuality = null;
    }
});
