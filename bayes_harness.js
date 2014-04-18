var csv = require('csv');
var url = require('url');
var S = require('string');
var StatsArray = require('stats-array');
var md5 = require('MD5');


var header = true;

/***************************
GET THE COMMAND LINE VARS
****************************/
/* get the training file name from command line */
var csvfile = process.argv[2];

/*get the threshold value. This is the percentile activity codes from the Bayes Classifier we want 
for example, 97 as a value here means give me the top 3%. */			
var thold = process.argv[3]/100; 		

/*get the token count for TF*IDF. This is the value to limit of TF*IDF tokens to use as classifier trainers*/
var tokcount = process.argv[4];

/* get the document length used to determine when we tokenize (shorten) using TF*IDF*/		
var tlen = process.argv[5];	

/* get the number of documents tokenized to reset the TF*IDF state*/		
var nDocsReset = process.argv[6];

/* get the number of codes at mininum that must be present to use a domain classifier*/		
var nCodesThreshold = process.argv[7];					


// init classifiers and TF*IDF
var natural = require('natural');
var TfIdf = natural.TfIdf;
var tfidf = new TfIdf();

var bayes = require('bayes');
var classifier = bayes();      //the general purpose classifier
var aClassifiers = [];

var doc = 0;
var short_doc = 0;
var total_count = 0;

var training_data = [];
var previous_text = '';
var bReady = false;

function getCodes(votes)
{
	var ans = [];
	l = votes.length;
	max_p = votes[0].vote;
	threshold = max_p*thold;

	for (var y = 0; y < l; y++)
	{	
		console.log(votes[y].vote+" "+threshold+" "+thold);
		if (typeof votes[y] != 'undefined' && votes[y].vote > threshold)
		{
			ans.push(votes[y].category);
		}
	}
	return ans;

}

function findCodeLength(theseClassifiers)
{
	var nSumCodes = 0;
	for (var g = 0; g < theseClassifiers.length; g++)
	{
		thisClassifier = theseClassifiers[g];
		nSumCodes = 0;
		var arCodes = [];
		if (thisClassifier.training_size >0 && thisClassifier.numProjects > 0)
		{
			nCodeLength = thisClassifier.training_size/thisClassifier.numProjects;
			for (var key in thisClassifier.nProjectsCodes) 
			{
				if (thisClassifier.nProjectsCodes.hasOwnProperty(key))
					arCodes.push(thisClassifier.nProjectsCodes[key]);
			}
			ci = arCodes.stdDeviation(thold/100.0);
			nMaxCodes = Math.round(nCodeLength + ci.upper);
			nMinCodes = Math.max(Math.round(nCodeLength - ci.lower),1);
			thisClassifier.codelength = nCodeLength;
			thisClassifier.maxcodelength = nMaxCodes;
			thisClassifier.mincodelength = nMinCodes;
			nSumCodes += nCodeLength;
		}
		else
		{
			nSumCodes += 0;
		}
	}
	if (theseClassifiers.length > 0)
	{
		return Math.max(nSumCodes/theseClassifiers.length,1);
	}
	else
	{
		return 1;
	}
}

function everybodyVotes(classVoters)
{
	
	//init the vote counts and ranking
	for (var v = 0; v < classVoters.length; v++)
	{
		//sort them by probability
		classVoters[v].sort(function(a, b){
			return b.probability-a.probability
		});
								
		var l = classVoters[v].length;
		for (var t = 0; (t < l) ; t++)
		{	
			classVoters[v][t].vote =  (100)/Math.abs(classVoters[v][t].probability);
		}
		
	}
	
	for (var v = 1; v < classVoters.length; v++)
	{
		var l = classVoters[v].length;
		var l2 = classVoters[v-1].length;
		for (var t = 0; (t < l ); t++)
		{	
			for (var p = 0; (p < l2 ); p++)
			{
				if (classVoters[v-1][p].category == classVoters[v][t].category)
				{
					classVoters[v][t].vote += classVoters[v-1][p].vote;
				}
			}
		}	
	}
			
	//sort by voting; final values will be in last voter
	classVoters[classVoters.length-1].sort(function(a, b){
		return b.vote-a.vote;
	});
	
	return classVoters[classVoters.length-1];
}

function findClasstoPrune(newClass)
{
	//if we have more than 100 classifiers in memory, pop off the oldest
	var l = aClassifiers.length;
	if ( l > 100 && l > 0)
	{
		console.log("Pruning: "+aClassifiers[0].hash);
		aClassifiers.splice (0,1);
	}
	//...and push on the new one
	aClassifiers.push(newClass);
	
}

function findClassifier(hk)
{
	var retval = -1;
	for (var y = 0; y < aClassifiers.length; y++)
	{
		if (aClassifiers[y].hash.localeCompare(hk) == 0)
		{
			retval = y;
			break;
		}
	}
	return retval;
}

function cleanText (text)
{
	text = S(strRow).stripTags().s;
 	text = S(text).stripPunctuation().s;
 	text = text.toLowerCase(text);
 	
 	return text;
}

function filterClass (szClass,classKey)
{
	return function(element) {
		//set key
		if (szClass == 'Donor + Recipient')
		{
			thisKey = element.donorrcptmd5; 
		} 
		else  if (szClass == 'Donor') 
		{
			thisKey =  element.donormd5;
		}
		else  if (szClass == 'Recipient') 
		{
			thisKey =  element.recipientmd5;
		}
		return (thisKey == classKey);
    }
}

csv()
.from.path(csvfile, { columns: true, delimiter: "\t" } )

// on each record, populate the map and check the codes
.on('record', function (data, index) 
{
    total_count += 1
	if ((((total_count) % 1000) == 0))
	{
		console.log("Learned "+ total_count+" coded projects.");
	}

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
 				strRow += data[key]+" ";
 				title = data[key];
 			}
 			if (key == 'short')
    	    {
 				strRow += data[key]+" ";
 				short_desc = data[key];
 			}
 			if (key == 'long')
    	    {
 				strRow += data[key]+" ";
 				long_desc = data[key];
 			}
 			
 			  
 		}
 		
 		//clean up the fields
 		strRow = cleanText(strRow);
 	
 		var rec = {
    		act_code: act_code,
    		donor: donor,
    		donormd5 : md5(donor),
    		recipientmd5: md5(recipient),
    		donorrcptmd5: md5 (donor+recipient),
    		project_id : project_id,
    		recipient: recipient,
    		text : strRow
		}

 		text = strRow;
 		//if doc length greater than length, tokenize using TF*IDF
 		if ((text.length > tlen) && (text != previous_text))
		{
 			tfidf.addDocument(text);
 			var i =0;
 			text = '';
 			tfidf.listTerms(doc).forEach(function(item) {
 			    i++;
				if( i <= tokcount)
				{
					text += item.term+' '; 
				}
				
			});
			doc++;
			rec.text = text;
			previous_text = text;
			
			//check if we should reset the TF*IDF//
			if ((doc % nDocsReset) == 0)
			{
				tfidf = null;
				tfidf = new TfIdf();
				doc = 0;
			}
 		}
 		
 		//save record
 		training_data.push(rec);
 		
		//the default classifier
		classifier.learn(text, act_code); 
 		
 	}
 })
 .on('end', function(count){
  
    bReady = true;
    var nProjectsCodes = [];
    var nProjs = 0;
  	// project codes
  	for (var y = 0; y < training_data.length; y++)
	{
		if (!nProjectsCodes[training_data[y].project_id])
		{
			nProjectsCodes[training_data[y].project_id] = 1;
			nProjs  = nProjs + 1;

		}
		else
		{
			nProjectsCodes[training_data[y].project_id]++;
		}
	}
	classifier.numProjects = nProjs;
	classifier.training_size = training_data.length;
	classifier.nProjectsCodes = nProjectsCodes;
	classifier.codelength = Math.round(count/nProjs);
	console.log("Done Training: Total Records: "+count);
 	
})

var sys = require("sys");
	
	var my_http = require("http");
	var nCodeLength = 0;
	var nMaxCodes = 1;
	var nMinCodes = 1;
	
	my_http.createServer(function(req,res){
	
		var body = "";
  		req.on('data', function (chunk) {
    		body += chunk;
  		});
  		
  		//parse the input string, get text, sector, donor and recipient
  		var queryData = url.parse(req.url, true).query;
  		input_string = queryData.description;				//get the text to classify from the querystring
  		sector = queryData.sector;							//get the sector data from the querystring
  		donor = queryData.donor;							//get the donor data from the querystring
  		recipient = queryData.recipient;					// get the recipient data from the querystring
  		
  		//handle request
  		req.on('end', function () {
    		
    		//answer array
    		var ans =[];
    		
    		
    		//check to see if the classifier is ready (has read all the training input)
    		if (bReady)
    		{
				var test = null;
				var szClass = 'Donor + Recipient';
				var classKey =  donor + recipient;
				var nCodes = 0;
				var nProjectsCodes = [];
				var training_size = 0;
				var nProjs = 0;
				var thisData;
				var theseClassifiers = [];
				var bFinished = false;
				
				while (!bFinished)
				{
					//the key is hashing the class (donor,etc)
					var hk = md5(classKey);

					//if we dont already have a classifier for this class-- 
					if (findClassifier(hk) < 0)
					{
						console.log("\tCreating Class Specific Coder for: "+classKey);
						
						//count training size
						thisData = training_data.filter(filterClass(szClass,md5(classKey)));
						training_size = thisData.length;
						
						//check to see if we have enough activity codes to attempt classification with
						if (training_size > nCodesThreshold)
						{
							// create the classifier if we dont have it
							var indexOf = findClassifier(hk);
							if (indexOf < 0) 
							{ 
								console.log("\tNot Found, must create for: "+classKey);
								var i = aClassifiers.length;
								
								//LRU the list of classifiers
								findClasstoPrune(bayes());
								
								//we pushed it onto the end
								i = aClassifiers.length;
								aClassifiers[i-1].hash = hk;
								
							}
								
							//the index of the classifier to use
							var i = findClassifier(hk);
							
							for (var y = 0; y < thisData.length; y++)
							{
								
								// keep track of codes per project
								if (!nProjectsCodes[thisData[y].project_id])
								{
									nProjectsCodes[thisData[y].project_id] = 1;
									nProjs  = nProjs + 1;
			
								}
								else
								{
									nProjectsCodes[thisData[y].project_id]++;
								}
					
								//learn the project/codes
								var text =  thisData[y].text;	
								aClassifiers[i].learn(text,  thisData[y].act_code);
							
							}
							aClassifiers[i].numProjects = nProjs;
							aClassifiers[i].training_size = thisData.length
							aClassifiers[i].nProjectsCodes = nProjectsCodes;
							theseClassifiers.push(aClassifiers[i]);
							
						}
						else
						{
							console.log("\tNot enough codes for: "+classKey+". Needed "+nCodesThreshold+", got "+training_size);
						}
						
						//try all class types
						if (szClass == 'Donor + Recipient')
						{
							classKey = donor;
							console.log("\tTrying Donor Only Class for: "+classKey);
							szClass = 'Donor';
							var t =  findClassifier(hk);
							if (t >= 0)
							{
								console.log("\Classifier Exists For: "+classKey);
								theseClassifiers.push(aClassifiers[t]);		
							}
							else
							{
								console.log("\tMust Create Classifier for: "+classKey);	
							}
							
						}
						else if (szClass == 'Donor')
						{
							classKey = recipient;
							console.log("\tTrying Recipient Only Class for: "+classKey);
							szClass = 'Recipient';
							var t =  findClassifier(hk);
							if (t >= 0)
							{
								console.log("\Classifier Exists For: "+classKey);
								theseClassifiers.push(aClassifiers[t]);	
							}
							else
							{
								console.log("\tMust Create Classifier for: "+classKey);	
							}
						}
						else
						{	
							bFinished = true;			
						}
			
					}
					else
					{				
						//if we have it cached, touch it to move it to the LRU
						console.log("\tUsing Cached copy for: "+classKey);
						touchedClass = aClassifiers[findClassifier(hk)];
						aClassifiers.splice(findClassifier(hk),1);
						aClassifiers.push(touchedClass);
						
						//TODO: hack!!!
						if (szClass == "Donor + Recipient")
						{
							szClass = "Donor";
						}
						if (szClass == "Donor")
						{
							szClass = "Recipient";
						}	
						if (szClass == "Recipient")
						{
							bFinished = true;
						}				
						theseClassifiers.push(aClassifiers[aClassifiers.length-1]);	
					}
				}
				//if we have all of our good classes to attempt classification with
				if (bFinished)
				{
					
		
					var classVoters = [];
					
					for (var r = 0; r < theseClassifiers.length; r++)
					{
						test = theseClassifiers[r].categorize_list(input_string);
						classVoters.push(test);
					}
					
					//use default only as last resort
					if (theseClassifiers.length == 0)
					{
						test = classifier.categorize_list(input_string);
						classVoters.push(test);
					}
					
					var votes = everybodyVotes(classVoters);
					
					// get codes to report out , based upon the threshold value
					ans = getCodes(votes);
						
				}	
			}
			else
			{
				ans = "Engine Not Ready; still training";
			}
			res.writeHeader(200, {"Content-Type": "text/json"});
			res.write(JSON.stringify(ans));
			res.end();
	});

}).listen(8081);
sys.puts("Server Running on 8081");	
 

