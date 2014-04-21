var csv = require('csv');
var url = require('url');
var S = require('string');
var StatsArray = require('stats-array');
var md5 = require('MD5');
var ss = require('simple-statistics');

var MAD = 3.5;

var header = true;

/***************************
GET THE COMMAND LINE VARS
****************************/
/* get the training file name from command line */
var csvfile = process.argv[2];

/*get the number of classifiers to cache */			
var nLRU = process.argv[3]; 

/*get the token count for TF*IDF. This is the value to limit of TF*IDF tokens to use as classifier trainers*/
var tokcount = process.argv[4];

/* get the document length used to determine when we tokenize (shorten) using TF*IDF*/		
var tlen = process.argv[5];	

/* get the number of documents tokenized to reset the TF*IDF state*/		
var nDocsReset = process.argv[6];

/* get the number of codes at minimum that must be present to use a domain classifier*/		
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

Array.prototype.sumvotes = function() {
    var a = this.concat();
    for(var i=0; i<a.length; ++i) {
        for(var j=i+1; j<a.length; ++j) {
            if(a[i].category === a[j].category)
            {
            	a[i].vote += a[j].vote;
                a.splice(j, 1);
            }
        }
    }
    return a;
};


function filter2(array, classKey, szClass)
 {
  	var results = [];
  	var item;
  
	for (var i = 0, len = array.length; i < len; i++) 
	{
		if (szClass == 'Donor + Recipient')
		{
			thisKey = array[i].donorrcptmd5; 
		} 
		else  if (szClass == 'Donor') 
		{
			thisKey =  array[i].donormd5;
		}
		else  if (szClass == 'Recipient') 
		{
			thisKey =  array[i].recipientmd5;
		}
		item = array[i];
		if (thisKey == classKey)
		{
			results.push(item);
		}
	}
	return results;
}

function countProjects (thisData)
{
	nProjs = 0;
	var nProjectsCodes = [];
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
	
	}
	return nProjs;
}

function getMad(votes)
{
	var ar = [];
	for (var y = 0;  y < Math.min(votes.length,30); y++)
	{
		ar.push(votes[y].vote);
	}
	var mad = ss.mad(ar);
	return mad;
}

function getMedian(votes)
{
	var ar = [];
	for (var y = 0; y < Math.min(votes.length,30); y++)
	{
		ar.push(votes[y].vote);
	}
	var median = ss.median(ar);
	return median;
}


//we give more votes to more specific classifiers; default is 1
function getVotesByClass (szClass)
{
	if (szClass == 'Donor + Recipient')
	{
		return 1.0;
	}
	else if (szClass == 'Donor')
	{
		return 0.25;
	}
	else if (szClass == 'Recipient')
	{
		return 0.25;
	}
	else
	{	
		return 0.1;			
	}
}

function getVotesMultByClass (szClass)
{
	if (szClass == 'Donor + Recipient')
	{
		return 1.0;
	}
	else if (szClass == 'Donor')
	{
		return 0.25;
	}
	else if (szClass == 'Recipient')
	{
		return 0.25;
	}
	else
	{	
		return 0.1;			
	}
}

function getCodesbyPercentile(votes)
{
	var ans = [];
	l = votes.length;
	max_p = votes[0].vote;
	threshold = max_p*thold;

	for (var y = 0; y < l; y++)
	{	
		
		if (typeof votes[y] != 'undefined' && votes[y].vote > threshold)
		{	
			console.log("\t\t"+votes[y].category+" "+votes[y].vote+" "+max_p);
			ans.push(votes[y].category);
		}
	}
	return ans;

}

function getCodesbyMAD(votes)
{
	var ans = [];
	l = votes.length;

	var mad = getMad(votes);
	var medianvotes = getMedian(votes);

	threshold = thold;  //from input parameters, the modified z-score



	for (var y = 0; y <  votes.length; y++)
	{	
		vote = 0.6745 * (votes[y].vote - medianvotes)/mad;
		if (typeof votes[y] != 'undefined' && vote > threshold)
		{
			console.log("\t\t"+votes[y].category+" "+votes[y].vote+" "+threshold+" "+vote);
			ans.push(votes[y].category);
		}
	}
	if (ans.length == 0)
	{
		ans.push(votes[0].category);
	}
	return ans;

}

function everybodyVotes(classVoters)
{
	//init the vote counts and ranking
	for (var v = 0; v < classVoters.length; v++)
	{	
		var l = classVoters[v].length;
		for (var t = 0; (t < l) ; t++)
		{	
			//console.log(classVoters[v][t].probability+" "+classVoters[v].votemult);
			classVoters[v][t].vote =  ((100)/Math.abs(classVoters[v][t].probability))*classVoters[v].votemult;
		}
	}

	
	var classSums = classVoters[0];
	for (var t = 1; (t < classVoters.length ); t++)
	{
		classSums = classSums.concat(classVoters[t]).sumvotes();
	}
	
	//sort by voting; final values will be in last voter
	classSums.sort(function(a, b){
		return b.vote-a.vote;
	});
	return classSums;
}

function findClasstoPrune(newClass)
{
	//if we have more than nLRU classifiers in memory, pop off the oldest
	var l = aClassifiers.length;
	if ( l > nLRU && l > 0)
	{
		console.log("Pruning: "+aClassifiers[0].className+" ("+aClassifiers[0].hash+")");
		var c = aClassifiers.splice (0,1);
		c = null;
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
    		donormd5 : md5(donor),
    		recipientmd5: md5(recipient),
    		donorrcptmd5: md5 (donor+recipient),
    		project_id : project_id,
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
    var nProjs = countProjects(training_data);
  
	classifier.numProjects = nProjs;
	classifier.training_size = training_data.length;
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
  		
  		thold = queryData.thold;
  		ttype = queryData.ttype;
  		purge = queryData.purge;
  		
  		//handle request
  		req.on('end', function () {
    		
    		//answer array
    		var ans =[];
    		
    		if (purge == 1)
    		{
    			console.log("\tPurging LRU Cache...");
    			for (var u = 0; u < aClassifiers.length; u++)
    			{
    				aClassifiers.pop();
    			}
    		}
    		//check to see if the classifier is ready (has read all the training input)
    		if (bReady)
    		{
				var test = null;
				var szClass = 'Donor + Recipient';
				var classKey =  donor + recipient;
				var nCodes = 0;
				var training_size = 0;
				var nProjs = 0;
				var theseClassifiers = [];
				var bFinished = false;
				
				while (!bFinished)
				{
					//the key is hashing the class (donor,etc)
					var hk = md5(classKey+szClass);
					
					//if we dont already have a classifier for this class-- 
					if (findClassifier(hk) < 0)
					{
						var thisData;
						console.log("\tAttempting Class Specific Coder for: "+classKey+szClass);
						
						//count training size
						//thisData = training_data.filter(filterClass(szClass,md5(classKey)));
						thisData = filter2(training_data, md5(classKey), szClass);
						training_size = thisData.length;
						
						nProjs = countProjects (thisData);					
						
						//check to see if we have enough activity codes to attempt classification with
						if (nProjs >= nCodesThreshold)
						{
							// create the classifier if we dont have it
							var indexOf = findClassifier(hk);
							if (indexOf < 0) 
							{ 
								console.log("\tNot Found in Cache, Must Create For: "+classKey+szClass);
								var i = aClassifiers.length;
								
								//LRU the list of classifiers
								findClasstoPrune(bayes());
								
								//we pushed it onto the end
								i = aClassifiers.length;
								aClassifiers[i-1].hash = hk;
								aClassifiers[i-1].className = classKey+szClass
								
							}
								
							//the index of the classifier to use
							var i = findClassifier(hk);
							
							for (var y = 0; y < thisData.length; y++)
							{
								var text =  thisData[y].text;	
								aClassifiers[i].learn(text,  thisData[y].act_code);
							
							}
							aClassifiers[i].numProjects = nProjs;
							aClassifiers[i].training_size = thisData.length;
							aClassifiers[i].votemult = getVotesMultByClass(szClass);
							theseClassifiers.push(aClassifiers[i]);
							
						}
						else
						{
							console.log("\tNot enough projects for: "+classKey+szClass+". Needed "+nCodesThreshold+", got "+nProjs);
						}		
					}
					else
					{				
						//if we have it cached, touch it to move it to the LRU
						console.log("\tClassifier Exists in Cache For: "+classKey+szClass);
						touchedClass = aClassifiers[findClassifier(hk)];
						aClassifiers.splice(findClassifier(hk),1);
						aClassifiers.push(touchedClass);
						theseClassifiers.push(touchedClass);
						
					}
					
					//try all class types
					if (szClass == 'Donor + Recipient')
					{
						classKey = donor;
						console.log("\tTrying Donor Only Class for: "+classKey+szClass);
						szClass = 'Donor';
						
					}
					else if (szClass == 'Donor')
					{
						classKey = recipient;
						console.log("\tTrying Recipient Only Class for: "+classKey+szClass);
						szClass = 'Recipient';
					}
					else
					{	
						bFinished = true;			
					}
				}
				//if we have all of our good classes to attempt classification with
				if (bFinished)
				{
					var classVoters = [];
					
					for (var r = 0; r < theseClassifiers.length; r++)
					{
						test = theseClassifiers[r].categorize_list(input_string);
						test.votemult = theseClassifiers[r].votemult;
						classVoters.push(test);
					}
					
					//use the dumb as dirt default classifier if we dont have domain specific ones
					if (theseClassifiers.length  == 0)
					{
						test = classifier.categorize_list(input_string);
						test.votemult = getVotesMultByClass('default');
						classVoters.push(test);
					}
										
					console.log("\tWe have "+classVoters.length+" classifiers voting.");
					var votes = everybodyVotes(classVoters);
					
					// get codes to report out , based upon the threshold value and threshold type
					if (ttype == 0)
					{
						ans = getCodesbyMAD(votes);
					}
					else
					{
						ans = getCodesbyPercentile(votes);
					}
					console.log("\t-----------------------------------------------");
						
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
 

