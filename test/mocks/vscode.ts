type ConfigValue = string | number | boolean | undefined;

interface ConfigurationSection {
    get<T extends ConfigValue>(key: string, defaultValue?: T): T;
}

function makeConfiguration(): ConfigurationSection {
    return {
        get<T extends ConfigValue>(_key: string, defaultValue?: T): T {
            return defaultValue as T;
        },
    };
}

export const workspace = {
    workspaceFolders: [],
    getConfiguration: () => makeConfiguration(),
};

export const window = {
    showWarningMessage: async <T extends string>(message: string, ...items: T[]): Promise<T | undefined> => {
        void message;
        return items[0];
    },
};

const vscode = {
    workspace,
    window,
};

export default vscode;
