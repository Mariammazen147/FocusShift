import * as vscode from 'vscode';
import { activateDetection } from './detection';

// Controller just delegates to activateDetection for now.
export class Controller {
  constructor(context: vscode.ExtensionContext) {
    activateDetection(context);
  }
}