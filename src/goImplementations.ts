'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import { byteOffsetAt, getBinPath, canonicalizeGOPATHPrefix } from './util';
import { promptForMissingTool } from './goInstallTools';
import { goKeywords, isPositionInString } from './util';
import { getGoRuntimePath, resolvePath } from './goPath';

interface GoListOutput {
	Dir: string;
	ImportPath: string;
}

interface GuruImplementsRef {
	name: string;
	pos: string;
	kind: string;
}

interface GuruImplementsOutput {
	type: GuruImplementsRef;
	to: GuruImplementsRef[];
	from: GuruImplementsRef[];
}

export class GoImplementationProvider implements vscode.ImplementationProvider {
	public provideImplementation(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.Definition> {
		return new Promise<vscode.Definition>((resolve, reject) => {
			if (token.isCancellationRequested) {
				return resolve(null);
			}

			let listProcess = cp.execFile(getGoRuntimePath(), ['list', '-e', '-json'], { cwd: vscode.workspace.rootPath }, (err, stdout, stderr) => {
				if (err) {
					return reject(err);
				}
				let listOutput = <GoListOutput>JSON.parse(stdout.toString());
				let scope = listOutput.ImportPath;
				let filename = canonicalizeGOPATHPrefix(document.fileName);
				let cwd = path.dirname(filename);
				let offset = byteOffsetAt(document, position);
				let goGuru = getBinPath('guru');
				let buildTags = '"' + vscode.workspace.getConfiguration('go')['buildTags'] + '"';
				let args = ['-scope', `${scope}/...`, '-json', '-tags', buildTags, 'implements', `${filename}:#${offset.toString()}`];

				let guruProcess = cp.execFile(goGuru, args, {}, (err, stdout, stderr) => {
					if (err && (<any>err).code === 'ENOENT') {
						promptForMissingTool('guru');
						return resolve(null);
					}

					if (err) {
						return reject(err);
					}

					let guruOutput = <GuruImplementsOutput>JSON.parse(stdout.toString());
					let results: vscode.Location[] = [];
					guruOutput.to.forEach(ref => {
						let match = /^(.*):(\d+):(\d+)/.exec(ref.pos);
						if (!match) return;
						let [_, file, lineStartStr, colStartStr] = match;
						let referenceResource = vscode.Uri.file(path.resolve(cwd, file));
						let range = new vscode.Range(
							+lineStartStr - 1, +colStartStr - 1, +lineStartStr - 1, +colStartStr
						);
						results.push(new vscode.Location(referenceResource, range));
					});
					return resolve(results);
				});
				token.onCancellationRequested(() => guruProcess.kill());
			});
			token.onCancellationRequested(() => listProcess.kill());
		});
	}
}
