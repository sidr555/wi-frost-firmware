// Use Dispatcher to connect and handle WebSocket messages
module.exports = function() {
    let ws = null;
    let listeners = {};

    this.on = (event, listener) => {
        listeners[event] = listener;
    };

    this.connect = (fn) => {
        if (typeof fn === "function") {
            this.connector = fn;
        }
        if (typeof this.connector === "function") {
            this.connector((socket) => {
                ws = socket;
                ws.on('open', () => {
                    console.log("Dispatcher connected");
                    this.handle("connect");
                });

                ws.on('close', () => {
                    console.log('Dispatcher closed');
                    this.handle("close");
                });

                ws.on('error', (err) => {
                    console.log('Dispatcher error');
                    this.handle("connect", err);
                })

                ws.on('message', (msg) => {
                    // console.log("WS MSG: " + msg);
                    // TODO prevent JS injection!
                    let arr = JSON.parse(msg);
                    this.handle(arr[0], arr[1]);
                });
            });
        }
    }

    this.send = (event, obj) => {
        if (ws) {
            ws.send(JSON.stringify([event, obj || ""]));
        }
    };

    this.handle = (event, data) => {
        if (typeof listeners[event] === "function") {
            return typeof data === "undefined" ? listeners[event]() : listeners[event](data);
        }
    }

}


