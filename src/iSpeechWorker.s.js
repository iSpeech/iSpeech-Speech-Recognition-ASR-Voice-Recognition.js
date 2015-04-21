importScripts('resampler.js', 'speex.js');

var apiKey,
	srcSampleRate,
	dstSampleRate,
	options,
	endpoint,
	silenceDetection;

var resampler,
	codec,
	webSocket,
	canSend,
	doneSending,
	dataBuffer,
	pcmbuffer,
	secondsRecorded;

var buff,
	buffIndex,
	maxDist;

this.onmessage = function(msg) {
	switch(msg.data.command) {
	case 'start':
		startStream(msg.data.params);
		break;
	case 'process':
		processAudio(msg.data.buffer);
		break;
	case 'stop':
		stopStreaming();
		break;
	case 'socketOpen':
		initConnection();
		break;
	}
}

startStream = function(params) {
	apiKey = params.apiKey;
	srcSampleRate = params.srcSampleRate;
	dstSampleRate = 16000;
	options = params.options;
	endpoint = params.endpoint;
	silenceDetection = params.silenceDetection;
	resampler = new Resampler(srcSampleRate, dstSampleRate, 1, 1000000, false);
	codec = new Speex({mode: 1});
	secondsRecorded = 0;
	buff = null;
	buffIndex = 0;
	maxDist = 0;
	connectToServer();
}

connectToServer = function() {
	canSend = false;
	doneSending = false;
	dataBuffer = [];
	pcmbuffer = new Int16Array();

	if(typeof WebSocket !== 'undefined') {
		webSocket = new WebSocket(endpoint);

		webSocket.onopen = function() {
			initConnection();
		}

		webSocket.onmessage = function(x) { // send the response from the server to the foreground
			this.postMessage({command: 'result', result: JSON.parse(x.data)});
			webSocket.close();
		}.bind(this);
	} else {
		this.postMessage({command: 'con'});
	}
}

initConnection = function() {
	sendToSocket('o' + buildURL());
	canSend = true;

	if(doneSending) {
		sendSpeex();
		sendToSocket("e");
	}
}

buildURL = function() {
	var ret =	"apikey=" + apiKey;
	ret += "&action=recognize";
	ret += "&speexmode=" + "2";
	ret += "&content-type=speex";
	ret += "&freeform=1";
	ret += "&deviceType=iOS";
	ret += "&output=json";

	if(!!options)
		ret += options;

	return ret;
}

processAudio = function(data) {

	if(doneSending)
		return;

	var floatBuffer = data;

	// resample to 16000
	floatBuffer = resampler.resampler(floatBuffer);

	secondsRecorded += floatBuffer.length / dstSampleRate;

	if(secondsRecorded >= 30) // stop the recording if it's longer than 30 seconds
		this.postMessage({command: 'stop'});

	var int16buffer = new ArrayBuffer(floatBuffer.length * 2);
	var view = new DataView(int16buffer);

	// convert floats to shorts
	floatTo16BitPCM(view, 0, floatBuffer);

	var int16data = new Int16Array(int16buffer);

	// append loose data from the last call
	int16data = appendData(pcmbuffer, int16data);

	// split the data into some integer of frames
	var dataSplits = splitData(int16data);
	int16data = dataSplits[0];
	pcmbuffer = dataSplits[1]; // save the loose data for next call

	if(silenceDetection && detectSilence(int16data, 16000, 0.25) && secondsRecorded > 2)
		this.postMessage({command: 'stop'});

	// encode the speex data
	var speexData = codec.encode(int16data, true);

	sendSpeex(speexData);
}

detectSilence = function(data, chunkSize, limit) {

	if(!buff)
		buff = new Array(chunkSize);

	for(var i = Math.max(0, data.length - chunkSize); i < data.length; i++) {
		buff[buffIndex] = data[i];
		buffIndex = (buffIndex+1) % buff.length;
	}

	var max = buff[0], min = buff[0];

	for(var i = 1; i < buff.length; i++) {
		if(max < buff[i])
			max = buff[i];

		if(min > buff[i])
			min = buff[i];
	}

	maxDist = Math.max(max - min, maxDist);
	return max - min < maxDist*limit;
}

splitData = function(data) {
	var split = data.length % codec.frame_size;

	return [data.subarray(0, data.length-split), data.subarray(data.length-split, data.length)];
}

appendData = function(base, data) {
	var ret = new Int16Array(base.length + data.length);
	
	for(var i = 0; i < base.length; i++) {
		ret[i] = base[i];
	}

	for(var i = 0; i < data.length; i++) {
		ret[base.length + i] = data[i];
	}

	return ret;
}

sendSpeex = function(data) {

	if(typeof data !== 'undefined') {
		var base64Data = base64_encode(data[0]);
		dataBuffer.push(base64Data);
	}

	while(canSend && dataBuffer.length > 0) { // only send when the socket is open and we have data
		sendToSocket("d" + dataBuffer.shift());
	}
}

sendToSocket = function(data) {
	if(!!webSocket) {
		webSocket.send(data);
	} else {
		this.postMessage({command: 'send', data: data});
	}
}

copy = function(buffer) {
	var ret = new Uint8Array(buffer.length);

	for(var i = 0; i < buffer.length; i++) {
		ret[i] = buffer[i];
	}

	return ret;
}

var base64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.split("");
function base64_encode (s) {
	// the result/encoded string, the padding string, and the pad count
	var r = ""; 
	var p = ""; 
	var c = s.length % 3;
 
	// add a right zero pad to make this string a multiple of 3 characters
	if (c > 0) {
		c = 3 - c;
		var ns = new Uint8Array(s.length + c);
		ns.set(s);

		for (var i = 0; i < c; i++) { 
			p += '='; 
			ns.set[s.length + i] = 0;
		}

		s = ns;
	}
 
	// increment over the length of the string, three characters at a time
	for (c = 0; c < s.length; c += 3) {
 
		// we add newlines after every 76 output characters, according to the MIME specs
		if (c > 0 && (c / 3 * 4) % 76 == 0) { 
			r += "\r\n"; 
		}
 
		// these three 8-bit (ASCII) characters become one 24-bit number
		var n = (s[c] << 16) + (s[c+1] << 8) + s[c+2];
 
		// this 24-bit number gets separated into four 6-bit numbers
		n = [(n >>> 18) & 63, (n >>> 12) & 63, (n >>> 6) & 63, n & 63];
 
		// those four 6-bit numbers are used as indices into the base64 character list
		r += base64chars[n[0]] + base64chars[n[1]] + base64chars[n[2]] + base64chars[n[3]];
	}
	// add the actual padding string, after removing the zero pad
	return r.substring(0, r.length - p.length) + p;
}

function floatTo16BitPCM(output, offset, input){
	for (var i = 0; i < input.length; i++, offset+=2){
		var s = Math.max(-1, Math.min(1, input[i]));
		output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
	}
}

stopStreaming = function() {
	doneSending = true;
	if(canSend)
		sendToSocket("e");
}
