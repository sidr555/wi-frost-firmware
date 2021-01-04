//var config = require("./config")
const wifi = require("Wifi");
// const http = require("http");
// const board = require("ESP8266");
// const Promise = require("Promise");
const WebSocket = require("ws");


const net_config = {
  wifi: {
    ssid: "Keenetic-0186",
    pass: "R838rPfr"
  },
  api: {
    protocol: "http",
    host: "192.168.0.41",
    port: "8050",
    wsport: "8051"
  }
};




let API = function(net_config) {
  let listeners = {};
  let ws = null;

  this.on = (event, listener) => {
    listeners[event] = listener;
  };

  this.send = (event, obj) => {
    if (ws) {
      ws.send(JSON.stringify([event, obj || ""]));
    }
  };

  this.connect = () => {
    console.log("connect API");
    wifi.connect(net_config.wifi.ssid, {
      password:net_config.wifi.pass
    }, (err) => {
      if (err) {
        if (typeof listeners["error"] === "function") {
          listeners["error"](err);
        }
        // console.log("Cannot connect WiFi ", config.wifi.ssid, err);
      } else {
        console.log("Connected WiFi", net_config.wifi.ssid);
        ws = new WebSocket(net_config.api.host,{
          path: '/',
          port: net_config.api.wsport, // default is 80
          protocol : "echo-protocol", // websocket protocol name (default is none)
          protocolVersion: 13, // websocket protocol version, default is 13
          origin: 'Espruino',
          keepAlive: 60,
          headers:{}// some:'header', 'ultimate-question':42 } // websocket headers to be used e.g. for auth (default is none)
        });

        ws.on('open', () => {
          console.log("WS connected", net_config.api.host);
          if (typeof listeners["connect"] === "function") {
            listeners["connect"]();
          }
        });

        ws.on('config', (msg) => {
          // console.log("WS config: " + msg);
          if (typeof listeners["config"] === "function") {
            listeners["config"](JSON.parse(msg));
          }
        });

        ws.on('message', (msg) => {
          // console.log("WS MSG: " + msg);
          let arr = JSON.parse(msg);
          if (typeof listeners[arr[0]] === "function") {
            listeners[arr[0]](arr[1]);
          }
        });

        ws.on('close', function() {
          console.log('WS closed')
          wifi.disconnect();
          if (typeof listeners["close"] === "function") {
            listeners["close"]();
          }
        });

        ws.on('error', function(err) {
          console.log('WS error')
          //wifi.close();
          if (typeof listeners["error"] === "function") {
            listeners["error"](err);
          }
        })
      }
    });

  }
}

let api = new API(net_config);

api.on("connect", () => {
  console.log("connect handler");
  api.send("config");
  api.send("limits");
  api.send("sensors");
  // api.send("task", "freeze");
});

api.on("error", (err) => {
  console.log("error handler", err);
});

api.on("close", () => {
  console.log("close handler");
  setTimeout(() => {
    api.connect();
  }, 6000)
});

// api.on("time", (time) => {
//   console.log("time handler", time, new Date(), new Date(time));
// });

api.on("config", (data) => {
  console.log("config handler", data);
});
api.on("sensors", (data) => {
  console.log("sensors handler", data);
});
api.on("limits", (data) => {
  console.log("limits handler", data);
});

api.connect();











// let API = function(host) {
//   this.get = (query, next, debug) => {
//
//     let req = http.request({
//       host: config.api.host,
//       port: config.api.port,
//       path: query,
//       method: 'GET',
//       protocol: config.api.protocol,
//       //headers: { key : value }
//     }, function(res) {
//       let content = '';
//
//       if (debug) console.log("api get req", query);
//       res.on("data", function(data){
//         content += data;
//         //if (debug) console.log("api data chunk", data);
//       });
//       res.on('close', function(data) {
//         content += data;
//         if (typeof next === 'function') {
//            next(null, content, req, res);
//         }
//         if (debug) console.log("API get data", query, content);
//       });
//     });
//     req.on('error', function(err) {
//       if (typeof next === 'function') {
//         if (debug) console.log("API query ERROR", query, err);
//         next(err, null, req);
//       }
//     });
//     req.end();
//   };
//
//   this.getJSON = (query, next) => {
//     this.get(query, function(err, data, req, res) {
//       if (!err) {
//         // FIXME prevent JS injections
//         data = JSON.parse(data);
//       }
//       if (typeof next === "function") {
//         next(err, data, req, res);
//       }
//     });
//   }
// };
//
// let api = new API(config.api.host);
//
//
// api.getJSON("/config", function(err, data){
//   console.log("config", data.brand, err);
// });




// setInterval(function() {
//   print("hello");
// }, 1000);
