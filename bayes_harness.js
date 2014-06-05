var csv = require('csv');
var url = require('url');
var S = require('string');
var ss = require('simple-statistics');
var md5 = require('MD5');

compress = require('compress-buffer').compress;
uncompress = require('compress-buffer').uncompress;


var header = true;


/***************************
GET THE COMMAND LINE VARS
****************************/
/* get the training file name from command line */
var csvfile = process.argv[2];

/*get the token count for TF*IDF. This is the value to limit of TF*IDF tokens to use as classifier trainers*/
var tokcount = process.argv[3];

/* get the document length used to determine when we tokenize (shorten) using TF*IDF*/		
var tlen = process.argv[4];	

/* get the number of documents tokenized to reset the TF*IDF state*/		
var nDocsReset = process.argv[5];

/* get the ration of bad to good examples*/		
var nRatio = process.argv[6];
							
// init classifiers and TF*IDF
var natural = require('natural');
var TfIdf = natural.TfIdf;

var weakClassifiers = [];

var weakTfidf = [];
var training_data = [];

var bayes = require('bayes');

var total_count = 0;
var bReady = false;

Array.prototype.sumvotes = function() {
    var a = this.concat();
    for(var i=0; i<a.length; ++i) 
    {
        for(var j=i+1; j<a.length; ++j) 
        {
            if(a[i].category === a[j].category)
            {
            	s = a[i].vote+a[j].vote;
            	a[i].nVotes += a[j].nVotes;
            	a[i].vote += a[j].vote;
                a.splice(j, 1); 
            }
        }
    }
    return a;
};

function insertIntoTraining(rec,training_data)
{
	i = locationOf(rec,training_data);
	if (i > 0)
	{
		if (training_data[i].coderulemd5 != rec.coderulemd5)
		{
			insert (rec, training_data);
		}
		else
		{
			training_data[i].count = training_data[i].count+1;
		}
	}
	else
	{
		insert (rec, training_data);
	}
}

function insert(element, array) 
{
	array.splice(locationOf(element, array) + 1, 0, element);
  	return array;
}

function locationOf(element, array, start, end) 
{
	if (array.length == 0) {
		return 0;
	}
	start = start || 0;
	end = end || array.length;
	var pivot = parseInt(start + (end - start) / 2, 10);
	if (array[pivot].coderulemd5 === element.coderulemd5)
	{
		return pivot;
	}
	if (end - start <= 1) 
	{
		return array[pivot].coderulemd5 > element.coderulemd5 ? pivot - 1 : pivot;
	}
	if (array[pivot].coderulemd5 < element.coderulemd5) 
	{
		return locationOf(element, array, pivot, end);
	} 
	else 
	{
		return locationOf(element, array, start, pivot);
	}
}

function locationOfActCode(act_code, array, start, end) 
{
	if (array.length == 0) {
		return 0;
	}
	start = start || 0;
	end = end || array.length;
	var pivot = parseInt(start + (end - start) / 2, 10);
	if (array[pivot].act_code === act_code)
	{
		while (pivot >= 0 && array[pivot].act_code == act_code)
		{
			pivot--;
		}
		pivot++;
		return pivot;
	}
	if (end - start <= 1) 
	{
		return 0;
	}
	if (array[pivot].act_code < act_code) 
	{
		return locationOfActCode(act_code, array, pivot, end);
	} 
	else 
	{
		return locationOfActCode(act_code, array, start, pivot);
	}
}

function locationOfProjCode(projcodemd5, array, start, end) 
{
	if (array.length == 0) {
		return 0;
	}
	start = start || 0;
	end = end || array.length;
	var pivot = parseInt(start + (end - start) / 2, 10);
	if (array[pivot].projcodemd5 === projcodemd5)
	{
		return 1;
	}
	if (end - start <= 1) 
	{
		return 0;
	}
	if (array[pivot].projcodemd5 < projcodemd5) 
	{
		return locationOfProjCode(projcodemd5, array, pivot, end);
	} 
	else 
	{
		return locationOfProjCode(projcodemd5, array, start, pivot);
	}
}

function initTF(classifiers)
{
	num = classifiers.length;
	for (var c = 0; c < num; c++)
	{
		g = new TfIdf();
		g.act_code = classifiers[c].act_code;
		
		weakTfidf.push(new TfIdf());
	}
}

function learnWeak(i,text,code)
{	
	text = featureSelect(weakTfidf[i],text,tokcount);
	weakClassifiers[i].learn(text,code);
}


function featureSelect (tfidf,text,tokcount)
{
	var i = 0;

	if (text.length > tlen)
	{
		tfidf.addDocument(text);
		text = '';
		doc = tfidf.documents.length -1;
		tfidf.listTerms(doc).forEach(function(item) 
		{
			i++;
			if( i <= tokcount)
			{
				text += item.term+' ';
			}
		});
	}
	return text;	
}


function getMad(votes)
{
	var ar = [];
	for (var y = 0;  y <  votes.length; y++)
	{
		ar.push(votes[y].prob);
	}
	var mad = ss.mad(ar);
	return mad;
}

function getMedian(votes)
{
	var ar = [];
	for (var y = 0; y < votes.length; y++)
	{
		ar.push(votes[y].prob);
	}
	var median = ss.median(ar);
	return median;
}

function getCodesbyMAD(votes, thold)
{
	var ans = [];
	l = votes.length;

	var mad = getMad(votes);
	var medianvotes = getMedian(votes);

	console.log("\t\tActivity Code\t\t\tRAW Vote\t\t\t\tMAD Vote\t\t\tMAD Threshold");
	var y = 0;
	while (y < votes.length)
	{	
		votes[y].di = votes[y].prob - medianvotes;
		
		votes[y].vote = ((0.6745)*(votes[y].di))/mad;
		
		console.log("\t\t"+votes[y].act_code+"\t\t\t"+votes[y].prob+"\t\t\t"+votes[y].di+"\t\t\t\t"+votes[y].vote);
		if (typeof votes[y] != 'undefined' && votes[y].vote > thold)
		{
			ans.push(votes[y]);
		}
		y++;
	}
	if (ans.length == 0 && votes.length > 0)
	{
		ans.push(votes[0]);
	}
	return ans;
}

function codeInProj(code,id, training_data)
{
	var index = locationOfActCode(code, training_data);
	
	bFound = false;
	while ((index < training_data.length) && (training_data[index].act_code === code) && (bFound == false))
	{
		if ( training_data[index].id === id)
		{
			bFound = true;
		}
		index++;
	}

	return bFound;
}
function everybodyVotes(classVoters,input_string)
{
	var ans = [];
	for (var v = 0; v < classVoters.length; v++)
	{	
		if (classVoters[v] != 'undefined')
		{	
			classVoters[v].sort(function(a, b){
				return b.probability-a.probability;
			});
			
			// if the vote is positive for this code, take the delta between positive and negative as the vote
			if (classVoters[v][0].category == "1")
			{
				var a1 = Object();
				a1.category = classVoters[v][0].category;
				a1.prob = classVoters[v][0].probability-classVoters[v][1].probability;
				a1.act_code = classVoters[v].act_code;
				ans.push(a1);
			}
		}
	}

	ans.sort(function(a, b){
		return b.prob-a.prob;
	});	
		
	return ans;

}


function cleanText (text)
{
	text = S(text).stripTags().s;
 	text = S(text).stripPunctuation().s;
 	text = text.toLowerCase(text);
 	
 	return text;
}


csv().from.path(csvfile, { columns: true, delimiter: "\t" } )

// on each record, populate the map and check the codes
.on('record', function (data, index) 
{
	if (header)
    {
    	strHeader ='';
    	for (key in data)
    	{	
 			strHeader += key+'|';	
 		}
 		header = false;	
 	}
 	else
 	{
		strRow ='';
		act_code ='';
		super_sector ='';
		sector ='';
		title ='';
		short_desc ='';
		long_desc ='';
		donor = '';
		recipient = '';
		project_id = '';
		for (key in data)
		{	
			var rec;
			data[key] = data[key].trim();
			if (key == 'act_code')
			{
				act_code = data[key];    
			}
			if (key == 'org')
			{
				donor = data[key];
			}
			 if (key == 'project_id')
			{
				project_id = data[key];
			}
			if (key == 'recipient')
			{
				recipient = data[key];
			}
			if (key == 'title') 
			{
				title = data[key];
			}
			if (key == 'short')
			{
				short_desc = data[key];
			}
			if (key == 'long')
			{
				long_desc = data[key];
			}	  
		}
		
		strRow = title+" "+short_desc+" "+long_desc;
		
		//clean up the fields
		text = cleanText(strRow);
		
		var rec = {
			act_code: act_code,
			id : project_id,
			count: 0,
			text : text,
			coderulemd5: md5(text+act_code),
			projcodemd5: md5(project_id+act_code)
		}
				
		if( (index % 1000) == 0)
		{
			console.log("Seen "+index+" coded projects.");
		}
		
		insertIntoTraining(rec,training_data);
		
	}
 })
 
 .on('end', function(count){
    console.log("Done Reading.");
    console.log("Finding Codes.");
    sz = training_data.length;
    for (var c = 0; c < sz; c++)
    {
    	bFound = false;
    	
		for (var y = 0; y < weakClassifiers.length; y++)
		{
			if (weakClassifiers[y].act_code == training_data[c].act_code)
			{
				weakClassifiers[y].count++;
				bFound = true;
			}
		}
		if (!bFound)
		{
			var cl = bayes();
			cl.pos = 0;
			cl.neg = 0;
			cl.count = 1;
			cl.act_code = training_data[c].act_code;
			weakClassifiers.push(cl);
		}
	}
	
	console.log("Codes Found: "+weakClassifiers.length);
	initTF(weakClassifiers);
	
	console.log("Sorting Codes.");
	
	training_data.sort(function(a, b){	
			return a.projcodemd5.localeCompare(b.projcodemd5);
		});
	
	console.log("Training Codes.");	
	var l = sz;
	
	//sort by activity code
	training_data.sort(function(a, b){	
		return a.act_code.localeCompare(b.act_code);
	});
	for (var y = 0; y < weakClassifiers.length; y++)
	{
	
		console.log("\tTraining classifier for: "+weakClassifiers[y].act_code);
		
		//find first of this code
		var thisCode = locationOfActCode(weakClassifiers[y].act_code, training_data);
		
		//train all positive codes
		console.log("\tTraining Positive Examples...");
		while (thisCode < l && training_data[thisCode].act_code == weakClassifiers[y].act_code)
		{
			weakClassifiers[y].pos++;
			learnWeak(y, training_data[thisCode].text, 1);
			thisCode++;
		}
		console.log("\tPositive Trained: "+ weakClassifiers[y].pos);
		console.log("\tTraining Negative Examples...");
		//train all negative codes; train at LEAST 1% of the total set as negative examples	
		thisRatio = 0;
		while (thisRatio < nRatio || weakClassifiers[y].neg < (l/100))
		{
			//find a negative example to train against
			var t = Math.floor(Math.random()*l);
			bF = codeInProj(weakClassifiers[y].act_code,training_data[t].id, training_data);
			while ((training_data[t].act_code == weakClassifiers[y].act_code) && (bF == true))
			{
				t = Math.floor(Math.random()*l);
				bF = codeInProj(weakClassifiers[y].act_code,training_data[t].id, training_data);
			}
				
			weakClassifiers[y].neg++;
			learnWeak(y, training_data[t].text, -1);
			thisRatio = weakClassifiers[y].neg/weakClassifiers[y].pos;
		}
		console.log("\tNegative Trained: "+ weakClassifiers[y].neg);
		
		if (weakClassifiers[y].neg > weakClassifiers[y].pos)
		{
			console.log("\tBalancing Training Example...");
		}
		
		var firstCode = locationOfActCode(weakClassifiers[y].act_code, training_data);	
		while (weakClassifiers[y].neg > weakClassifiers[y].pos)
		{
			var thisCode = firstCode;
			while (thisCode < l && training_data[thisCode].act_code == weakClassifiers[y].act_code && weakClassifiers[y].neg > weakClassifiers[y].pos)
			{
				weakClassifiers[y].pos++;
				learnWeak(y, training_data[thisCode].text, 1);
				thisCode++;
			}	
		}
			
		console.log("\t\tTotal Positive: "+weakClassifiers[y].pos+", Total Negative: "+weakClassifiers[y].neg);
	}
	
	//clean up
	sz = l-1;
	while (sz--)
	{
		training_data.splice(sz,1);
	}
	
	console.log("End Training.");
	
})

var sys = require("sys");
	
	var my_http = require("http");
	my_http.createServer(function(req,res){
	
		var body = "";
  		req.on('data', function (chunk) {
    		body += chunk;
  		});
  		
  		//parse the input string, get text, sector, donor and recipient
  		var queryData = url.parse(req.url, true).query;
  		orig_input_string = queryData.description;			//get the text to classify from the querystring
  		id = queryData.id;
  		
  		thold = queryData.thold;
  		input_string = cleanText(orig_input_string);
  		
  		//handle request
  		req.on('end', function () {
    	
    		//answer array
    		var ans =[];
    			
			//check to see if the classifier is ready (has read all the training input)
			
			console.log("Project: " +id);
			
			var test = null;
			var nCodes = 0;
			var nProjs = 0;
					
			//if we have all of our good classes to attempt classification with
			var classVoters = [];
		
			for (var r = 0; r < weakClassifiers.length; r++)
			{
				test = weakClassifiers[r].categorize_list(input_string);
				test.act_code =  weakClassifiers[r].act_code;
				classVoters.push(test);	
			}		
			
			console.log("\tWe have "+classVoters.length+" classifiers voting.");
			var votes = everybodyVotes(classVoters, input_string);
		
			ans = getCodesbyMAD(votes, thold);
			console.log("\t-----------------------------------------------");				
				
			res.writeHeader(200, {"Content-Type": "text/json"});
			res.write(JSON.stringify(ans));
			res.end();
	});

}).listen(8081);
sys.puts("Server Running on 8081");	
 

