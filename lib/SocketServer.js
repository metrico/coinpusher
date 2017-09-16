"use strict";

const Promise = require("bluebird");
const EventEmitter = require("events");
const path = require("path");
const WebSocket = require("uws");
const WebSocketServer = WebSocket.Server;
const http = require("http");
const express = require("express");
const debug = require("debug")("coinpusher:socketserver");

function heartbeat() {
    this.isAlive = true;
}

class SocketServer extends EventEmitter {

    constructor(config = null, coinpusher = null){
        super();

        this.coinpusher = coinpusher;
        this.config = config || { port: 3000 };
        this.wss = null;
        this._hbintv = null;
        this.server = null;
    }

    _registerHttpEndpoints(app){

        app.get("/", (req, res) => {
            res.status(200).json({
                "/graph": `http://localhost:${this.config.port}/graph`,
                "/coinstreams": `http://localhost:${this.config.port}/coinstreams`,
                "/currencies": `http://localhost:${this.config.port}/currencies`,
                "/nn/train/:currency": `http://localhost:${this.config.port}/nn/train/etheur`,
                "/nn/status": `http://localhost:${this.config.port}/nn/status`
            });
        });

        app.use("/graph", express.static(path.join(__dirname, "../client")));

        app.get("/coinstreams", (req, res) => {
            res.status(200).json(this.coinpusher.css.map(cs => cs.getStats()));
        });

        app.get("/currencies", (req, res) => {
            res.status(200).json(this.coinpusher.getAvailableCurrencies());
        });

        app.get("/nn/train/:currency", (req, res) => {
            this.coinpusher.updateNetworkForCurrency(req.params.currency).then(result => {
                if(result){
                    res.status(200).json({message: "trained"});
                } else {
                    res.status(500).json({message: "failed"});
                }
            });
        });

        app.get("/nn/status", (req, res) => {
            res.status(200).json(this.coinpusher.getNetworkStats());
        });
    }

    start(){
        return new Promise(resolve => {

            const app = express();

            app.use((req, res, next) => {
                debug("express hit", req.url);
                next();
            });

            this._registerHttpEndpoints(app);

            const server = http.createServer(app);

            debug("starting", this.config);
            this.wss = new WebSocketServer(Object.assign({}, this.config, {server}));

            this._hbintv = setInterval(() => {

                if(!this.wss){
                    return;
                }

                this.wss.clients.forEach(socket => {

                    if (socket.isAlive === false){
                        debug("kicking socket for inactivity");
                        return socket.terminate();
                    } 
                
                    socket.isAlive = false;
                    socket.ping("", false, true);
                });
            }, 3000);
            
            this.wss.on("connection", (socket, req) => {

                debug("new client");

                socket.isAlive = true;
                socket.on("pong", heartbeat);
                super.emit("new", socket);

                socket.on("message", message => {
                    debug("client sent data", message);
                    super.emit("message", message);    
                });

                socket.on("close", () => {
                    debug("client left");
                    super.emit("gone", socket);
                });
            });

            this.server = server.listen(this.config.port, () => {
                resolve();
            });
        });
    }

    broadcast(message){
        message = typeof message !== "string" ? JSON.stringify(message) : message;
        this.wss.clients.forEach(socket => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(message)
            }
        });
    }

    close(){

        if(this._hbintv){
            clearInterval(this._hbintv);
        }

        if(this.wss){
            this.wss.close();
        }

        if(this.server){
            this.server.close();
        }
    }

}

module.exports = SocketServer;