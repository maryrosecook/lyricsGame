var artist = require("./modules/artist"),
	song = require("./modules/songs"),
	utilsRegex = require("./utils/regex"),
	cheerio = require("cheerio"),
	request = require("request"),
	util = require("util"),
	async = require("async"),
	Artist = require("./MongoDB/schema").Artist,
	_ = require("underscore"),
	mongoose = require("mongoose");

// https://github.com/MatthewMueller/cheerio
// https://github.com/mikeal/request
// http://nodejs.org/api/util.html
// http://underscorejs.org/
// https://github.com/caolan/async
// http://mongoosejs.com/docs/guide.html

// Connect to DB
mongoose.connect("mongodb://localhost/rapgenius");

var artistURL = "http://rapgenius.com/artists/";
var homeURL = "http://rapgenius.com";
var rapper = new artist(process.argv[2] || "Skinnyman");

// Search for artist
request(artistURL+rapper.name, function (error, response, body) {
    if (!error && response.statusCode == 200) {
		addAlbums(body);
    } else {
		console.log("Artist not found on Rap Genius");
    }
});

// Process artist page

var addAlbums = function (body) {
	// Update rapper class with URL and name
	var $ = cheerio.load(body);
    var URL = $("[property='og:url']").attr("content");
    var nameFromURL = $("[property='og:title']").attr("content");
    rapper.addLink(URL);
    rapper.updateName(nameFromURL);

	// For each album, create but don't execute an instance of the processAlbum function - save into an array
    var processAlbumsTasks = [];
    $(".album_list li a").each(function() {
		var baseAlbumURL = (homeURL + this.attr("href"));
		var task = buildfn(baseAlbumURL);
		processAlbumsTasks.push(task);
    });


    // Have an anonymous callback funtion that saves the data into rapgenius DB
    async.parallel(processAlbumsTasks, function (errors, results) {
   	// https://github.com/caolan/async#parallel
		console.log('all albums processed', errors, results);
		// New Mongo document based on a Mongoose model
		var rapperMongoDocument = new Artist(rapper);
		rapperMongoDocument.save(function (err) {
			if(err===null) {
				console.log("Data for " + rapper.name + " successfully saved into DB");
				rapper.printFourLyricsFromARandomSong();
				process.exit(1);
			} else {
				console.log('Following error occured when saving '+ rapper.name +' into the DB: ' + err);
				process.exit(2);
			}
		});
    })
};

var buildfn = function(baseAlbumURL) {
	// Closure invoked w/ async.parallel
	var processAlbum = function (callback) {
		console.log("processing album", baseAlbumURL);
		request(baseAlbumURL, function (error, response, body) {
			console.log("album processed", baseAlbumURL);
			if (!error && response.statusCode == 200) {
			    var $ = cheerio.load(body);
			    var albumTitle = utilsRegex.obtainAlbumTitle($("h1.name a.artist")["0"]["next"]["data"]);
				if(_.indexOf(rapper.albums, albumTitle) == -1) {
					rapper.addAlbum(albumTitle);
			    }
			    // Extract album year from albumTitle if present
				var year = albumTitle.match(/\(\d{4}\)/);
			    if (year===null) {
					year = -1;
			    } else {
					year = year[0].replace(/(\(|\))/g,"");
			    }
			    addSongs(year, albumTitle, $, function (err) {
					callback(err);
			    });
			} else {
			    console.log("Error in retrieveing album: " + error);
			    callback(error);
			}
		});
	};
	return processAlbum;
};

// process song(s)
var addSongs = function (year, albumTitle, $, callback) {
	var processSongsTasks = [];
    $(".song_list .song_link").each(function() {
		var songURL = (homeURL + this.attr("href"));
		var track = new song(albumTitle, songURL, year);
		var task = buildfn2(songURL, track);
		processSongsTasks.push(task);
    });
    async.parallel(processSongsTasks, function (errors, results) {
		console.log("All songs in " + albumTitle + " processed", errors, results);
		callback(errors, results);
    });
};

var buildfn2 = function (songURL, track) {
	// Closure invoked w/ async.parallel
	var processSong = function (callback) {
		console.log('processing song', songURL);
		request(songURL, function (error, response, body) {
			if (!error && response.statusCode == 200) {
			var $ = cheerio.load(body);
			var songTitle = utilsRegex.obtainSongTitle($("h1.song_title a")["0"]["next"]["data"]);
				var trackNumber = $(".album_title_and_track_number").text().trim().split(" ")[1];
				var lyricsText = $(".lyrics_container .lyrics p").text();
				var songlyrics = lyricsText.split("\n");
				track.addSongName(songTitle);
				track.addTrackNumber(trackNumber);
				track.addArtist(rapper.name);
				track.addLyrics(songlyrics);
				rapper.addSong(track);
				callback(null);
			} else {
				console.log("Error retrieveing song details");
				callback(error);
			}
		});
	};
	return processSong;
};