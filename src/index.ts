import cluster, { Worker } from "cluster";
import http from "http";
import https from "https";
import { cpus } from "os";
import EventEmitter from "events";

declare namespace Cluster {
    export interface Options {
        readonly advanced?: http.ServerOptions | https.ServerOptions;
        readonly listen?: {
            readonly port?: number;
            readonly hostname?: string;
            readonly backlog?: number;
            listeningListener?(): any;
        };
        readonly events?: {
            readonly error?: "exit" | "continue" | "throw" | "log";
            readonly exit?: "restart" | "exit" | "log";
        }
        readonly isHttps?: boolean;
        app(req: http.IncomingMessage, res: http.ServerResponse): void | Promise<void>;
    }
}

class Cluster extends EventEmitter {
    constructor(
        public readonly options: Cluster.Options,
        private readonly instances: number = cpus().length
    ) {
        super();
    }

    on(event: "start", listener: (worker: Worker) => void): this;
    on(event: "error", listener: (err: Error, cp: NodeJS.Process) => void): this;
    on(event: "exit", listener: (worker: Worker, code: number, signal: string) => void): this;
    on(event: string, listener: (...args: any[]) => void) {
        return super.on(event, listener);
    }

    start() {
        const opts = this.options;
        const listenOpts = opts.listen || {};
        const evOpts = opts.events || {};

        if (cluster.isPrimary) {
            for (let i = 0; i < this.instances; ++i) {
                const cw = cluster.fork();

                this.emit("start", cw);

                cw.on("disconnect", () =>
                    cluster.disconnect()
                );
            }

            cluster.on("exit", (...args) => {
                // Exit normally
                if (evOpts.exit === "exit")
                    process.exit();
                // Restart the child process
                else if (evOpts.exit === "restart")
                    cluster.fork();
                // Log the action
                else if (evOpts.exit === "log")
                    console.log("Worker", args[0].process.pid, "exited.");
                // If no action has been made till this point call the event handler
                else 
                    this.emit("exit", ...args);
            });
        } else {
            const handler = (err: Error) => {
                // Throw the error
                if (evOpts.error === "throw")
                    throw err;
                // Disconnect all processes
                else if (evOpts.error === "exit") {
                    process.emit("disconnect");
                    process.exit();
                }
                // Log the error
                else if (evOpts.error === "log") {
                    console.log("Error:", "\"" + err.message + "\"", "in child process", process.pid);
                    process.exit();
                }
                // Emit the error event if no action has been done yet
                else 
                    this.emit("error", err, process);
            };

            process.on("uncaughtException", handler);

            (opts.isHttps ? https : http)
                .createServer(opts.advanced, opts.app)
                .listen(
                    listenOpts.port,
                    listenOpts.hostname,
                    listenOpts.backlog,
                    listenOpts.listeningListener
                );
        }
    }
}

export = Cluster;