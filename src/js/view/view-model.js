import SimpleModel from 'model/simplemodel';

function ViewModel(playerModel) {
    this.attributes = {
        viewSetup: false,
        aspectratio: 1.78,
        width: 640,
        height: 360,
        stretching: 'uniform',
        logo: null,
        logoWidth: 0,
        altText: '',
        cues: undefined,
        scrubbing: false,
        inDom: false,
        audioMode: undefined,
        touchMode: undefined,
    };
    this.playerModel = playerModel;


    playerModel.on('all', (type, objectOrEvent, value) => {
        console.log('model', type, objectOrEvent, value);
        this.trigger(type, objectOrEvent, value);
    });
}

Object.assign(ViewModel.prototype, SimpleModel, {
    get(attr) {
        // console.warn(`model.get(${attr})`);
        if (attr === 'mediaModel') {
            console.error(`no model.get(${attr})!`);
        }
        return this.attributes[attr] || this.playerModel.get(attr);
    },
    change(attr, callback, context) {
        if (this.attributes[attr]) {
            console.warn(`viewModel.change(${attr}, ...)`);
            return this.playerModel.change(attr, callback, context);
        }
        console.warn(`model.change(${attr}, ...)`);
        return SimpleModel.change.call(this, attr, callback, context);
    },
    getVideo() {
        console.error('no mode.getVideo()!')
        return this.playerModel.getVideo();
    },
    setPlaybackRate(rate) {
        console.error(`no mode.setPlaybackRate(${rate})!`);
        return this.playerModel.setPlaybackRate(rate);
    },
    // Just for testing:
    // set(attr, val) {
    //     console.warn(`model.set(${attr}, ${val})`);
    //     return SimpleModel.set.call(this, attr, val);
    // },
    // on(name, callback, context) {
    //     console.warn(`model.on(${name}, ...)`);
    //     return SimpleModel.on.call(this, name, callback, context);
    // },
    // once(name, callback, context) {
    //     console.warn(`model.on(${name}, ...)`);
    //     return SimpleModel.once.call(this, name, callback, context);
    // },
});


Object.defineProperties(ViewModel.prototype, {
    mediaController: {
        enumerable: true,
        get: function() {
            console.error('no model.mediaController!');
            return this.playerModel.mediaController;
        }
    }
});

export default ViewModel;
