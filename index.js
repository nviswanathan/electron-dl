'use strict';
const path = require('path');
const {app, BrowserWindow, shell, dialog} = require('electron');
const unusedFilename = require('unused-filename');
const pupa = require('pupa');
const extName = require('ext-name');
let win = null;
let pendingDownload = [];
let waitingForDownloadItem = null;
let downloadItems = new Set();
let receivedBytes = 0;
let completedBytes = 0;
let totalBytes = 0;
const activeDownloadItems = () => downloadItems.size;
const progressDownloadItems = () => receivedBytes / totalBytes;

function getFilenameFromMime(name, mime) {
	const exts = extName.mime(mime);

	if (exts.length !== 1) {
		return name;
	}

	return `${name}.${exts[0].ext}`;
}

function addNextDownload(){
	if(waitingForDownloadItem == null){
		console.log("Check for download next item")
		let toDownload = pendingDownload.shift();
		if(toDownload){
			addDownload(toDownload);
		}
	}
}

function addSessionListner(e, item, webContents){
	if(waitingForDownloadItem){
		waitingForDownloadItem(e, item, webContents)
	}
}

function registerListener(){
	let session = win.webContents.session;
	session.on('will-download',addSessionListner)		
}

function removeListener(){
	if(win != null){
		win.webContents.session.removeListener(addSessionListner);
	}
}

function addDownload(options, cb = () => {}) {

	options = Object.assign({
		showBadge: true
	}, options);

	const listener = (e, item, webContents) => {
		downloadItems.add(item);
		let itemTotalBytes = item.getTotalBytes();
		let itemResivedBytes = item.getReceivedBytes();
		const progressDownloadItem = () => itemResivedBytes / itemTotalBytes;
		totalBytes += item.getTotalBytes();

		let hostWebContents = webContents;
		if (webContents.getType() === 'webview') {
			({hostWebContents} = webContents);
		}

		const win = BrowserWindow.fromWebContents(hostWebContents);

		const dir = options.directory || app.getPath('downloads');
		let filePath;
		if (options.filename) {
			filePath = path.join(dir, options.filename);
		} else {
			const filename = item.getFilename();
			const name = path.extname(filename) ? filename : getFilenameFromMime(filename, item.getMimeType());

			filePath = unusedFilename.sync(path.join(dir, name));
		}

		const errorMessage = options.errorMessage || 'The download of {filename} was interrupted';
		const errorTitle = options.errorTitle || 'Download Error';

		if (!options.saveAs) {
			item.setSavePath(filePath);
		}

		if (typeof options.onStarted === 'function') {
			options.onStarted(item);
		}

		item.on('updated', () => {
			receivedBytes = [...downloadItems].reduce((receivedBytes, item) => {
				receivedBytes += item.getReceivedBytes();
				return receivedBytes;
			}, completedBytes);
			itemResivedBytes  = item.getReceivedBytes();
			if (options.showBadge && ['darwin', 'linux'].includes(process.platform)) {
				app.setBadgeCount(activeDownloadItems());
			}

			if (!win.isDestroyed()) {
				win.setProgressBar(progressDownloadItems());
			}

			if (typeof options.onProgress === 'function') {
				options.onProgress(progressDownloadItem());
			}
		});

		item.on('done', (event, state) => {
			completedBytes += item.getTotalBytes();
			downloadItems.delete(item);

			if (options.showBadge && ['darwin', 'linux'].includes(process.platform)) {
				app.setBadgeCount(activeDownloadItems());
			}

			if (!win.isDestroyed() && !activeDownloadItems()) {
				win.setProgressBar(-1);
				receivedBytes = 0;
				completedBytes = 0;
				totalBytes = 0;
			}

			// if (options.unregisterWhenDone) {
			// 	session.removeListener('will-download', listener);
			// }

			if (state === 'cancelled') {
				if (typeof options.onCancel === 'function') {
					options.onCancel(item);
				}
			} else if (state === 'interrupted') {
				const message = pupa(errorMessage, {filename: item.getFilename()});
				// commeted by viswanathan to avide notification window
				// dialog.showErrorBox(errorTitle, message);
				options.reject(new Error(message));
			} else if (state === 'completed') {
				if (process.platform === 'darwin') {
					app.dock.downloadFinished(filePath);
				}

				if (options.openFolderWhenDone) {
					shell.showItemInFolder(path.join(dir, item.getFilename()));
				}

				options.resolve(item);
			}
		});
		waitingForDownloadItem = null;
		addNextDownload();
	};
	waitingForDownloadItem = listener;
	win.webContents.downloadURL(options.url);
}

module.exports = (options = {}) => {
	app.on('session-created', session => {
		registerListener(session, options);
	});
};

// TODO: Remove this for the next major release
module.exports.default = module.exports;

module.exports.registerWinSession = (window) => {
	if(win == null){
		win = window;
		registerListener()
	} else {
		// throw new Error("Windo already registered")
	}
}

module.exports.removeSessionListener = () => {
	removeListener();
	win = null;
}

module.exports.clearPendingDownloads = () => {
	if(pendingDownload.length > 0){
		pendingDownload.slice(0, pendingDownload.length);
	}
}

module.exports.download = (url, options) => new Promise((resolve, reject) => {
	if(win != null){
		options = Object.assign({}, options);
		options.resolve = resolve;
		options.reject = reject;
		options.url = url;
		pendingDownload.push(options);
		addNextDownload();
	} else {
		throw new Error("Window not registered")
	}
});
