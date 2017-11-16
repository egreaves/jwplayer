import cancelable from 'utils/cancelable';
import { resolved } from 'polyfills/promise';
import { MediaModel } from 'controller/model';
import { seconds } from 'utils/strings';

import { MEDIA_PLAY_ATTEMPT, MEDIA_PLAY_ATTEMPT_FAILED, PLAYER_STATE,
    STATE_PAUSED, STATE_BUFFERING, STATE_IDLE } from 'events/events';

export default class MediaController {
    constructor(provider, model) {
        this.provider = provider;
        this.model = model;
        this.mediaModel = null;
        this.thenPlayPromise = cancelable(() => {});
    }

    init(item) {
        const { model, provider } = this;
        provider.init(item);
        provider.setState(STATE_IDLE);
        const mediaModel = this.mediaModel = new MediaModel();
        const position = item ? seconds(item.starttime) : 0;
        const duration = item ? seconds(item.duration) : 0;
        const mediaModelState = mediaModel.attributes;
        mediaModel.srcReset();
        mediaModelState.position = position;
        mediaModelState.duration = duration;
        model.setProvider(provider);
        model.setMediaModel(mediaModel);
    }

    reset() {
        this.mediaModel = null;
    }

    play(item, playReason) {
        const { model, mediaModel, provider } = this;

        if (!playReason) {
            playReason = model.get('playReason');
        }

        model.set('playRejected', false);
        let playPromise = resolved;
        if (mediaModel.get('setup')) {
            playPromise = provider.play();
        } else {
            playPromise = loadAndPlay(item, provider, model);
            mediaModel.set('setup', true);
            if (!mediaModel.get('started')) {
                playAttempt(playPromise, model, playReason, provider);
            }
        }
        return playPromise;
    }

    stop() {
        const { provider } = this;
        provider.stop();
    }

    pause() {
        this.provider.pause();
    }

    preload(item) {
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

    get audioTrack() {
        return this.provider.getCurrentAudioTrack();
    }

    get quality() {
        return this.provider.getCurrentQuality();
    }

    get audioTracks() {
        return this.provider.getAudioTracks();
    }

    get preloaded() {
        return this.mediaModel.get('preloaded');
    }

    get qualities() {
        return this.provider.getQualityLevels();
    }

    get setup() {
        return this.mediaModel && this.mediaModel.get('setup');
    }

    set audioTrack(index) {
        this.provider.setCurrentAudioTrack(index);
    }

    set controls(mode) {
        this.provider.setControls(mode);
    }

    set position(pos) {
        this.provider.seek(pos);
    }

    set quality(index) {
        this.provider.setCurrentQuality(index);
    }

    set subtitles(index) {
        if (this.provider.setSubtitlesTrack) {
            this.provider.setSubtitlesTrack(index);
        }
    }
}

function loadAndPlay(item, provider, model) {
    // Calling load() on Shaka may return a player setup promise
    const providerSetupPromise = provider.load(item);
    if (providerSetupPromise) {
        const thenPlayPromise = model.thenPlayPromise = cancelable(() => {
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


