/// <reference types="vite/client" />

declare const __VERSION__: string;
declare const __TASKLESS_CLI__: string;
declare const __TASKLESS_CLI_NOTICE__: string;
declare const __TASKLESS_BUILD_TARGET__: "prod" | "self" | "nightly";
/** The npm lockfile this build's launcher installs from; `null` for `self`. */
declare const __TASKLESS_INSTALL_LOCK__: string | null;
