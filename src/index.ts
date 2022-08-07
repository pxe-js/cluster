import cluster, { Worker } from "cluster";
import http, { IncomingMessage, ServerResponse } from "http";
import https from "https";
import { cpus } from "os";
import EventEmitter from "events";

declare namespace Cluster {
    // This exit option exits the child process
    export type ErrorEvent = "exit" | "continue" | "throw" | "log";
    // This exit option exits the main process
    export type ExitEvent = "exit" | "log";

    export interface Options {
        readonly advanced?: http.ServerOptions | https.ServerOptions;
        readonly listen?: {
            readonly port?: number;
            readonly hostname?: string;
            readonly backlog?: number;
            listeningListener?(): any;
        };
        readonly events?: {
            readonly error?: ErrorEvent | ErrorEvent[];
            readonly exit?: ExitEvent | ExitEvent[];
        }
        readonly isHttps?: boolean;
    }

    export interface App {
        (req: IncomingMessage, res: ServerResponse): void | Promise<void>
    }
}

function normalizeOptions(cls: Cluster) {
    let opts = cls.options;

    // If not set options and instances to default value
    if (!opts)
        // @ts-ignore
        cls.options = opts = {};

    if (!cls.instances)
        // @ts-ignore
        cls.instances = cpus().length;

    if (!opts.events)
        // @ts-ignore
        opts.events = {};

    if (!opts.listen)
        // @ts-ignore
        opts.listen = {};

    for (const key in opts.events)
        if (!Array.isArray(opts.events[key]))
            opts.events[key] = [opts.events[key]];
}

class Cluster extends EventEmitter {
    readonly options: Cluster.Options;
    readonly app: Cluster.App;
    readonly instances: number;

    constructor(app: Cluster.App);
    constructor(app: Cluster.App, instances: number);
    constructor(app: Cluster.App, options: Cluster.Options);
    constructor(app: Cluster.App, instances: number, options: Cluster.Options);

    constructor(...args: any[]) {
        super();

        const firstArg = args[0], nextArg = args[1], lastArg = args[2];

        // Throw error if no app is provided
        if (typeof firstArg !== "function")
            throw new Error("Target app is not specified");

        this.app = firstArg;

        if (nextArg) {
            // If there are 3 args
            if (lastArg) {
                this.options = lastArg;
                this.instances = nextArg;
            }

            // If there are two args
            else {
                // If next arg is a number set the value to instance
                if (typeof nextArg === "number")
                    this.instances = nextArg;

                else
                    this.options = nextArg;
            }
        }

        normalizeOptions(this);
    }

    private fork() {
        const cw = cluster.fork();

        this.emit("start", cw);

        cw.on("disconnect", () => 
            cluster.disconnect()
        );
    }

    on(event: "start", listener: (worker: Worker) => void): this;
    on(event: "error", listener: (err: Error, cp: NodeJS.Process) => void): this;
    on(event: "exit", listener: (worker: Worker, code: number, signal: string) => void): this;
    on(event: string, listener: (...args: any[]) => void) {
        return super.on(event, listener);
    }

    start() {
        const opts = this.options;
        const listenOpts = opts.listen;
        const evOpts = opts.events;

        const handler = (err: Error) => {
            // Throw the error
            if (evOpts.error?.includes("throw"))
                throw err;

            // Log the error
            if (evOpts.error?.includes("log"))
                console.log("Error:", "\"" + err.message + "\"", "in child process", process.pid);

            // Disconnect all processes
            if (evOpts.error?.includes("exit")) {
                process.emit("disconnect");
                process.exit();
            }

            // Emit the error event if no action has been done yet
            this.emit("error", err, process);
        };

        const exit = (...args: any[]) => {
            // Log the action
            if (evOpts.exit?.includes("log"))
                console.log("Worker", args[0].process.pid, "exited.");

            // Exit normally
            if (evOpts.exit?.includes("exit"))
                process.exit();

            // If no action has been made till this point call the event handler
            this.emit("exit", ...args);
        };

        if (cluster.isPrimary) {
            for (let i = 0; i < this.instances; ++i)
                this.fork();

            cluster.on("exit", exit);
        } else {
            process.on("uncaughtException", handler);

            (opts.isHttps ? https : http)
                .createServer(opts.advanced, this.app)
                .listen(
                    listenOpts.port || 8080,
                    listenOpts.hostname,
                    listenOpts.backlog,
                    listenOpts.listeningListener
                );
        }
    }
}

export = Cluster;