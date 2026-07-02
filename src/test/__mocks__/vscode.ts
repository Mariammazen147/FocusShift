const vscode = {
  workspace: {
    getConfiguration: () => ({
      get: (_key: string, defaultVal: any) => defaultVal,
    }),
  },
  window: {
    showInformationMessage: jest.fn(),
  },
  Uri: {
    parse: (str: string) => ({ toString: () => str }),
  },
  DiagnosticSeverity: {
    Error: 0,
    Warning: 1,
    Information: 2,
    Hint: 3,
  },
};

export = vscode;
