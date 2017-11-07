import ProviderController from 'providers/provider-controller';
import { resolved } from 'polyfills/promise';
import { seconds } from 'utils/strings';
import getMediaElement from 'api/get-media-element';
import Model from 'controller/model';

export default function ProgramController(model) {
    let _provider = null;
    let providerController = ProviderController(model.getConfiguration());

    return {
        setActiveItem(item) {
            model.mediaModel.off();
            model.mediaModel = new Model.MediaModel();
            resetItem(model, item);
            model.set('minDvrWindow', item.minDvrWindow);
            model.set('mediaModel', model.mediaModel);
            model.attributes.playlistItem = null;
            model.set('playlistItem', item);

            const source = item && item.sources && item.sources[0];
            if (source === undefined) {
                // source is undefined when resetting index with empty playlist
                throw new Error('No media');
            }

            let ProviderConstructor = providerController.choose(source);
            let providerPromise = resolved;

            // We're changing providers
            if (!ProviderConstructor || !(_provider && _provider instanceof ProviderConstructor)) {
                // We haven't loaded the provider we need
                if (!ProviderConstructor) {
                    providerPromise = model.loadProviderList(model.get('playlist'));
                }

                // We're switching from one piece of media to another, so reset it
                if (_provider) {
                    resetProvider(_provider, model);
                    _provider = null;
                    replaceMediaElement(model);
                }
            }

            const mediaModelContext = model.mediaModel;
            return providerPromise
                .then(() => {
                    ProviderConstructor = providerController.choose(source);
                    // The provider we need couldn't be loaded
                    if (!ProviderConstructor) {
                        resetProvider(_provider, model);
                        _provider = null;
                        model.set('provider', undefined);
                        throw new Error('No providers for playlist');
                    }
                })
                .then(( ) => {
                    // Don't do anything if we've tried loading another provider while model promise was resolving
                    if (mediaModelContext === model.mediaModel) {
                        syncPlayerWithMediaModel(mediaModelContext);
                        let nextProvider = _provider;
                        if (!nextProvider) {
                            // We need to make a new provider
                            nextProvider = new ProviderConstructor(model.get('id'), model.getConfiguration());
                            _provider = nextProvider;
                            return model.changeVideoProvider(nextProvider, item);
                        }
                        return model.setProvider(nextProvider, item);
                    }
                    return resolved;
                });
        }
    };
}

function resetItem(model, item) {
    const position = item ? seconds(item.starttime) : 0;
    const duration = item ? seconds(item.duration) : 0;
    const mediaModelState = model.mediaModel.attributes;
    model.mediaModel.srcReset();
    mediaModelState.position = position;
    mediaModelState.duration = duration;

    model.set('playRejected', false);
    model.set('itemMeta', {});
    model.set('position', position);
    model.set('duration', duration);
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
