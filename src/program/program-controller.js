import ProviderController from 'providers/provider-controller';
import { resolved } from 'polyfills/promise';
import { seconds } from 'utils/strings';
import getMediaElement from 'api/get-media-element';

export default function ProgramController(model) {
    let _provider = null;
    let providerController = ProviderController(model.getConfiguration());

    return {
        setActiveItem(item) {
            const source = item && item.sources && item.sources[0];
            if (source === undefined) {
                // source is undefined when resetting index with empty playlist
                throw new Error('No media');
            }

            if (_provider && !providerController.canPlay(_provider, source)) {
                // If we can't play the source with the current provider, reset the current one and
                // prime the next tag within the gesture
                resetProvider(_provider, model);
                _provider = null;
                replaceMediaElement(model);
            }

            const mediaModelContext = model.mediaModel;
            return this.loadProviderConstructor(source)
                .then((ProviderConstructor) => {
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
                        return this.setProvider(nextProvider, item);
                    }
                    return resolved;
                });
        },
        loadProviderConstructor(source) {
            let ProviderConstructor = providerController.choose(source);
            if (ProviderConstructor) {
                return Promise.resolve(ProviderConstructor);
            }

            return model.loadProviderList(model.get('playlist'))
                .then(() => {
                    ProviderConstructor = providerController.choose(source);
                    // The provider we need couldn't be loaded
                    if (!ProviderConstructor) {
                        resetProvider(_provider, model);
                        _provider = null;
                        model.set('provider', undefined);
                        throw new Error('No providers for playlist');
                    }
                    return ProviderConstructor;
                });
        },
        setProvider(nextProvider, item) {
            _provider = nextProvider;
            model.setProvider(nextProvider);
            // this allows the providers to preload

            if (_provider.init) {
                _provider.init(item);
            }

            // Set the Provider after calling init because some Provider properties are only set afterwards
            model.set('provider', _provider.getName());

            // Listening for change:item won't suffice when loading the same index or file
            // We also can't listen for change:mediaModel because it triggers whether or not
            // an item was actually loaded
            model.trigger('itemReady', item);
            return resolved;
        }
    };
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
