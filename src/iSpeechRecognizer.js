/**
 *
 * Object for handling ASR
 *
 * @class
 * @constructor
 * @param {object} param - parameters
 * @param {string} param.apiKey - iSpeech api key (defaults to developerdemokeydeveloperdemokey)
 * @param {iSpeechRecognizer~onResponse} param.onResponse - function to handle ASR results (defautls to printing the results using console.log)
 * @param {boolean} param.silenceDetection - enable or disable silence detection (defaults to true)
 * @param {string} param.workerLoc - path to worker location (defaults to iSpeechWorker.js)
 */
iSpeechRecognizer = function(params) {
	this.commands = [];
	this.aliasList = {};
	this.optionalCommands = {};
	this.endpoint = "wss://malcom.ispeech.org:8431/";

	params = params || {};
	this.apiKey = params.apiKey || "developerdemokeydeveloperdemokey";
	this.onResponse = params.onResponse || this.onResponse;
	this.silenceDetection = params.silenceDetection || true;
	this.workerLoc = params.workerLoc || 'iSpeechWorker.js';

	window.navigator = window.navigator || {};
	navigator.getUserMedia = navigator.getUserMedia ||
							navigator.webkitGetUserMedia ||
							navigator.mozGetUserMedia	||
							null;
	if (navigator.getUserMedia === null) {
		this.onResponse({result:'error', code:10001, message:'Browser not supported'});
		return;
	}
	this.audioContext = null;
}

iSpeechRecognizer.IDLE = 0;
iSpeechRecognizer.WAITING_USER = 1;
iSpeechRecognizer.RECORDING = 2;

/**
 * Current recording state.
 * <br><br>
 * <table class="params">
 * <thead><td>Name</td><td>Value</td></thead>
 * <tbody>
 * <tr><td>IDLE</td><td>0</td></tr>
 * <tr><td>WAITING_USER</td><td>1</td></tr>
 * <tr><td>RECORDING</td><td>2</td></tr>
 * </tbody>
 * </table>
 */
iSpeechRecognizer.prototype.state = iSpeechRecognizer.IDLE;

iSpeechRecognizer.prototype.isBrowserSupported = function() {
	return navigator.getUserMedia != null;
}

/**
 * Start recording audio to recognize. <br><br>
 * <b>Note:<b> this will prompt the user to allow audio recording
 * the first time this is called. If the source site is http
 * rather than https it will prompt the user every time.
 */
iSpeechRecognizer.prototype.start = function() {
	if(this.state != iSpeechRecognizer.IDLE)
		return;

	navigator.getUserMedia({
		video: false,
		audio: true
	}, this.startRecording.bind(this),
	function(error) {
		this.onResponse({result:'error', code:10001, message:'Audio capture error: '+error.code});
	});

	this.state = iSpeechRecognizer.WAITING_USER;
}

/** @private */
iSpeechRecognizer.prototype.startRecording = function(localMediaStream) {

	// get the audio context
	var AudioContext = window.AudioContext || window.webkitAudioContext;
	this.audioContext = new AudioContext();

	this.mediaStream = localMediaStream; // save the stream for later

	var source = this.audioContext.createMediaStreamSource(localMediaStream); // get the source

	this.context = source.context;
	this.node = (this.context.createScriptProcessor ||
			 this.context.createJavaScriptNode).call(this.context, 8192, 1, 1); // get the node with a buffer of 4096 and one input/output channel

	this.worker = new Worker(this.workerLoc); // start up our worker

	this.worker.onmessage = this.onWorkerMessage.bind(this);

	//send the start params
	this.worker.postMessage({
		command: 'start',
		params: {
			apiKey: this.apiKey,
			srcSampleRate: this.context.sampleRate,
			options: this.commandArgs(),
			endpoint: this.endpoint,
			silenceDetection: this.silenceDetection
		}
	});

	this.node.onaudioprocess = this.processAudio.bind(this); // set the onaudioprocess
	source.connect(this.node); // connect the node to the source
	this.node.connect(this.context.destination);    //this should not be necessary

	this.state = iSpeechRecognizer.RECORDING;
}

/** @private */
iSpeechRecognizer.prototype.processAudio = function(e) {
	var buffer = [];
	buffer = e.inputBuffer.getChannelData(0);

	// send the audio to the worker
	this.worker.postMessage({
		command: 'process',
		buffer: buffer
	});
}

/** @private */
iSpeechRecognizer.prototype.onWorkerMessage = function(e) {
	switch(e.data.command) {
	case 'result':
		if(!!this.onResponse)
			this.onResponse(e.data.result);
		break;

	case 'con':
		this.webSocket = new (WebSocket || MozWebSocket)(this.endpoint);
		this.webSocket.onopen = function() {
			this.worker.postMessage({
				command: 'socketOpen'
			});
		}.bind(this);

		this.webSocket.onmessage = function(x) { // send the response from the server to the foreground
			var res = JSON.parse(x.data);
			this.onWorkerMessage({data:{command: 'result', result: res}});
			if(res.result.toLowerCase() == "success") {
				this.webSocket.close();
			}
		}.bind(this);
		break;

	case 'send':
		if(!!this.webSocket)
			this.webSocket.send(e.data.data);
		break;

	case 'stop':
		this.stop();
		break;

	case 'log':
		console.log(e.data);
		break;
	}
}

/**
 *
 * This callback is called when an ASR result is given.
 * 
 * @callback iSpeechRecognizer~onResponse
 * @param {object} response - The response from the server.
 * @param {string} response.result - The success of the query. Will typically be 'success' or 'error'.
 * @param {string} response.text - The recognized text. Will not exist on an error.
 * @param {string} response.confidence - the confidence of the recognized text.
 * @param {integer} response.code - The error code, if there is one.
 * @param {string} response.message - An error message, if there is one.
 */
iSpeechRecognizer.prototype.onResponse = function(resp) {
	console.log(resp);
}

/**
 * Stop recording audio.
 */
iSpeechRecognizer.prototype.stop = function() {
	if(this.state != iSpeechRecognizer.RECORDING)
		return;

	this.state = iSpeechRecognizer.IDLE;

	this.worker.postMessage({
		command: 'stop'
	});
	this.worker.terminate();
	this.audioContext.close();
	this.mediaStream.stop();
	this.node.disconnect();
	this.node.onaudioprocess = function(){};
}

/**
 * Adds a command phrases.
 * <p>
 * Example:
 * </p>
 * 
 * <code>
 * rec.addCommand([&#39;yes&#39;,&#39;no&#39;]);
 * </code>
 * <p>
 * The user can now speak "Yes" or "No" and it will be recognized correctly.
 * 
 * @param {string|string[]} Commands An array containing your command phrases
 */
iSpeechRecognizer.prototype.addCommand = function(command) {
	this.commands = this.commands.concat(command);
}

/**
 * <p>
 * Adds an alias to use inside of a command. You can reference the added
 * alias using %ALIASNAME% from within a command. Alias names are
 * automatically capitalized. Note: You can only have a maximum of two
 * aliases per command.
 * </p>
 * <p>
 * Example:
 * </p>
 * 
 * <code>
 * var names = [ &#39;jane&#39;, &#39;bob&#39;, &#39;john&#39; ];<br>
 * rec.addAlias(&#39;NAMES&#39;, names);<br>
 * rec.addCommand(&#39;call %NAMES%&#39;);<br>
 * </code>
 * <p>
 * The user can now speak "call john" and it will be recognized correctly.
 * </p>
 * 
 * @param {string} Alias The name of your alias for referencing inside of your commands.
 * @param {string|string[]} Values The list of phrases for this alias.
 */
iSpeechRecognizer.prototype.addAlias = function(alias, values) {
	this.aliasList[alias] = [].concat(values);
}

/**
 * Specify additional parameters to send to the server.
 *
 * @param {string} Key - Parameter Key
 * @param {string} Value - Parameter Value
 */
iSpeechRecognizer.prototype.addOptionalCommand = function(key, value) {
	this.optionalCommands[key] = value;
}

/**
 * Sets to Locale for recognizer.<br><br>
 * 
 * <table class="params">
 * <thead><tr><td>Country</td><td>Locale</td><tr></thead>
 * <tbody>
 * <tr><td>Catalan (Catalan)</td><td>'ca-ES'</td></tr>
 * <tr><td>Chinese (Taiwan)</td><td>'zh-TW'</td></tr>
 * <tr><td>Danish (Denmark)</td><td>'da-DK'</td></tr>
 * <tr><td>English (United States)</td><td>'en-US'</td></tr>
 * <tr><td>Finnish (Finland)</td><td>'fi-FI'</td></tr>
 * <tr><td>French (France)</td><td>'fr-FR'</td></tr>
 * <tr><td>Italian (Italy)</td><td>'it-IT'</td></tr>
 * <tr><td>Japanese (Japan)</td><td>'ja-JP'</td></tr>
 * <tr><td>Korean (Korea)</td><td>'ko-KR'</td></tr>
 * <tr><td>Dutch (Netherlands)</td><td>'nl-NL'</td></tr>
 * <tr><td>Norwegian (Norway)</td><td>'nb-NO'</td></tr>
 * <tr><td>Polish (Poland)</td><td>'pl-PL'</td></tr>
 * <tr><td>Portuguese (Brazil)</td><td>'pt-BR'</td></tr>
 * <tr><td>Russian (Russia)</td><td>'ru-RU'</td></tr>
 * <tr><td>Swedish (Sweden)</td><td>'sv-SE'</td></tr>
 * <tr><td>Chinese (People's Republic of China)</td><td>'zh-CN'</td></tr>
 * <tr><td>English (United Kingdom)</td><td>'en-GB'</td></tr>
 * <tr><td>Spanish (Mexico)</td><td>'es-MX'</td></tr>
 * <tr><td>Portuguese (Portugal)</td><td>'pt-PT'</td></tr>
 * <tr><td>Chinese (Hong Kong S.A.R.)</td><td>'zh-HK'</td></tr>
 * <tr><td>English (Australia)</td><td>'en-AU'</td></tr>
 * <tr><td>Spanish (Spain)</td><td>'es-ES'</td></tr>
 * <tr><td>French (Canada)</td><td>'fr-CA'</td></tr>
 * <tr><td>English (Canada)</td><td>'en-CA'</td></tr>
 * </tbody>
 * </table>
 *
 * @param {string} Locale Locale from the list above.
 */
iSpeechRecognizer.prototype.setLocale = function(locale) {
	this.addOptionalCommand("locale", locale);
}

/** Clear the set commands and aliases. */
iSpeechRecognizer.prototype.clearCommandAndAlias = function() {
	this.commands = [];
	this.aliasList = {};
	this.optionalCommands = {};
}

/** @private */
iSpeechRecognizer.prototype.pipeSeparate = function(list) {
	var ret = encodeURIComponent(list[0]);

	for(var i = 1; i < list.length; i++) {
		ret += "|" + encodeURIComponent(list[i]);
	}

	return ret;
}

/** @private */
iSpeechRecognizer.prototype.commandArgs = function() {
	var ret = "";
	var alias = [];

	for(var i = 0; i < this.commands.length; i++) {
		alias.push("command" + (i+1));
		ret += "&" + alias[i] + "=" + encodeURIComponent(this.commands[i]);
	}

	for(var key in this.aliasList) {
		ret += "&" + encodeURIComponent(key.toUpperCase()) + "=" + this.pipeSeparate(this.aliasList[key]);
		alias.push(key.toUpperCase());
	}

	if(alias.length > 0)
		ret += "&alias=" + this.pipeSeparate(alias);

	for(var key in this.optionalCommands) {
		ret += "&" + encodeURIComponent(key) + "=" + encodeURIComponent(this.optionalCommands[key]);
	}

	return ret;
}
