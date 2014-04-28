var csv = require('csv');
var url = require('url');
var S = require('string');
var md5 = require('MD5');
var ss = require('simple-statistics');
var compress = require('compress-buffer').compress;
var uncompress = require('compress-buffer').uncompress;

var MAD = 3.5;

var header = true;
var previous_proj = '';

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

/* get the number of codes at minimum that must be present to use a domain classifier*/		
var npcttrain = process.argv[8];					
				


// init classifiers and TF*IDF
var natural = require('natural');
var TfIdf = natural.TfIdf;
var tfidf = new TfIdf();

var bayes = require('bayes');
var classifier = bayes();      //the general purpose classifier
var act_classifiers = [];
var aClassifiers = [];

var doc = 0;
var total_count = 0;

var training_data = [];
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
            	//console.log("Reinforcing: "+a[i].category+", "+a[i].vote+" ==> "+s);
            	a[i].nVotes += a[j].nVotes;
            	a[i].vote += a[j].vote;
                a.splice(j, 1); 
            }
        }
    }
    return a;
};

function findcoderule(array,textmd5)
{
	var results = [];
  
	for (var i = 0, len = array.length; i < len; i++) 
	{
		thisKey = array[i].textmd5;
		bFound = false;
		if (thisKey == textmd5)
		{
			for (var y = 0; y < results.length; y++)
			{
				if (results[y] == array[i].act_code)
				{
					bFound = true;
				}
			}
			if (!bFound)
			{
				results.push(array[i].act_code);
			}
		}
	}
	
	return results;
}

function fastfilter(array, classKey, szClass)
 {
  	var results = [];
  	
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
		if (thisKey == classKey)
		{
			results.push(array[i]);
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

function getVotesMultByClass (szClass)
{
	if (szClass == 'Donor + Recipient')
	{
		return 2.00;
	}
	else if (szClass == 'Donor')
	{
		return 1.00;
	}
	else if (szClass == 'Recipient')
	{
		return 1.00;
	}
	else
	{	
		return 1.00;			
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
			ans.push(votes[y].category);
		}
	}
	if (ans.length == 0)
	{
		ans.push(votes[0].category);
	}
	return ans;

}

function everybodyVotes(classVoters,input_string)
{
	var ar_act = [];
	for (key in act_classifiers)
	{
		if (act_classifiers[key].categorize_list && act_classifiers[key].nExamples > nCodesThreshold)
		{
			test = act_classifiers[key].categorize_list(input_string);
			test.votemult = 1.0;
			if (test[0].probability != 0)
			{
				ar_act.push(test[0]);
			}
		}
	}	
	
	ar_act.votemult = getVotesMultByClass("Activity Codes");
	if (ar_act.length > 0)
	{
		classVoters.push(ar_act);
	}	
	
	//init the vote counts and ranking
	for (var v = 0; v < classVoters.length; v++)
	{	

		var l = classVoters[v].length;
		for (var t = 0; (t < l) ; t++)
		{	
			classVoters[v][t].vote =  ((100)/Math.abs(classVoters[v][t].probability))*classVoters[v].votemult;
			classVoters[v][t].nVotes = 1;

		}
	}

	//sum votes...
	var classSums = classVoters[0];
	for (var t = 1; (t < classVoters.length ); t++)
	{
		classSums = classSums.concat(classVoters[t]).sumvotes();
	}
	
	
	//..and average them
	for (var t = 0; (t < classSums.length ); t++)
	{
		classSums[t].vote = classSums[t].vote/classVoters.length;
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

function insert(element, array) 
{
  array.splice(locationOf(element, array) + 1, 0, element);
  return array;
}

function locationOf(element, array, start, end) 
{
  if (array.length == 0)
  	return 0;
  start = start || 0;
  end = end || array.length;
  var pivot = parseInt(start + (end - start) / 2, 10);
  if (array[pivot].project_id === element.project_id) return pivot;
  if (end - start <= 1)
    return array[pivot].project_id > element.project_id ? pivot - 1 : pivot;
  if (array[pivot].project_id < element.project_id) {
    return locationOf(element, array, pivot, end);
  } else {
    return locationOf(element, array, start, pivot);
  }
}

function findProject(training_data, rec)
{
	var retval = false;
	
	var i = locationOf(rec,training_data);
	if (i >= 0)
	{
		//console.log(training_data[i].project_id+" Found "+rec.project_id+" at: "+i);
		retval = true;
		while ( i > 0 && training_data[i].project_id === rec.project_id)
		{
			i--;
		}
		i++;
		while ( i < training_data.length && training_data[i].project_id === rec.project_id)
		{
		//	console.log("Setting at: "+i);
			training_data[i].trainset = true;
			i++;
		}
	}
	else
	{
		console.log("Not Found: "+rec.project_id);
	}
	return retval;
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
	text = S(text).stripTags().s;
	text = text.replace(/[\.,-\/#!$%\^&\*;:{}=\-_`~()]/g," ");
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
			donormd5 : md5(donor),
			recipientmd5: md5(recipient),
			donorrcptmd5: md5 (donor+recipient),
			project_id : project_id,
			text : text,
			trainset : false,
			textmd5: md5(text)
		}
		
		//if doc length greater than length, tokenize using TF*IDF
		if (text.length > tlen) 
		{
			tfidf.addDocument(text);
			var i =0;
			text = '';
			tfidf.listTerms(doc).forEach(function(item) 
			{
				i++;
				if( i <= tokcount)
				{
					//repeat the term by the tfidf weight
					for (var rep = 0; rep <  (item.tfidf / 10)+1; rep ++)
					{
						text += item.term+' ';
					}
				}
			});
			doc++;
			rec.text = text;
	
			//check if we should reset the TF*IDF//
			if ((doc % nDocsReset) == 0)
			{
				tfidf = null;
				tfidf = new TfIdf();
				doc = 0;
			}
		}
		var comp = new Buffer(rec.text, 'utf8');
		rec.text = compress(comp);
		
		if( (index % 1000) == 0)
			console.log("Seen "+ index+" coded projects.");
	
		//save record in the sorted list
		insert(rec,training_data);
		
		if (Math.random() > (1-npcttrain) )
		{
			rec.trainset = true;
			findProject(training_data,rec);
		}
	}
 })
 
 .on('end', function(count){
  
    bReady = true;
    var nProjectsCodes = [];
    var nProjs = countProjects(training_data);
    
    //train
    total_count += 1;

	var count = 0;
	for ( var v = 0; v < training_data.length; v++)
	{
		if (training_data[v].trainset)
		{
			count++;
			if ((count % 1000) == 0)
			{
				console.log("\tLearned "+ count+" coded projects.");
			}
	
			//the default classifier, make it learn
			
			text = uncompress(training_data[v].text);
			text = text.toString('utf8');
			classifier.learn(text, training_data[v].act_code);

			//the individual activity code classifiers, make them learn
			if (!act_classifiers[training_data[v].act_code])
			{
				act_classifiers[training_data[v].act_code] = bayes();
				act_classifiers[training_data[v].act_code].learn(text, training_data[v].act_code);
				act_classifiers[training_data[v].act_code].nExamples =  1;
			}
			else
			{
				act_classifiers[training_data[v].act_code].learn(text, training_data[v].act_code);
				act_classifiers[training_data[v].act_code].nExamples++;
			}
		}
	}
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
  		orig_input_string = queryData.description;			//get the text to classify from the querystring
  		sector = queryData.sector;							//get the sector data from the querystring
  		donor = queryData.donor;							//get the donor data from the querystring
  		recipient = queryData.recipient;					// get the recipient data from the querystring
  		id = queryData.id;
  		
  		thold = queryData.thold;
  		ttype = queryData.ttype;
  		purge = queryData.purge;
  	
  		input_string = cleanText(orig_input_string);
  		
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
    		
    		// check to see if this can be coded by rule
    		coderule = [];
    		coderule = findcoderule(training_data, md5(input_string));
    		bFinished = (coderule.length > 0);
    		
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
					
						// filter and count training size
						thisData = fastfilter(training_data, md5(classKey), szClass);
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
								var text =  uncompress(training_data[y].text).toString('utf8');	
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
				
					//use the dumb as dirt default classifier, too
				
					test = classifier.categorize_list(input_string);
					test.votemult = getVotesMultByClass('default');
					classVoters.push(test);
					
					console.log("\tProject: " +id);
					// get codes to report out , based upon the code rules, or threshold value and threshold type
					if (coderule.length > 0)
					{
						console.log("\tCoding By Rule.." + JSON.stringify(coderule));
						ans = coderule;
					}
					else
					{
						console.log("\tUnable to Code By Rule, We have "+classVoters.length+" classifiers voting.");
						var votes = everybodyVotes(classVoters, input_string);
						if (ttype == 0)
						{
							ans = getCodesbyMAD(votes);
						}
						else
						{
							ans = getCodesbyPercentile(votes);
						}
					}
					console.log("\t-----------------------------------------------");				
				}	
			}
			else
			{
				res.writeHeader(200, {"Content-Type": "text/json"});
				res.write("Engine is training, please wait");
				res.end();
			}	
			res.writeHeader(200, {"Content-Type": "text/json"});
			res.write(JSON.stringify(ans));
			res.end();
	});

}).listen(8081);
sys.puts("Server Running on 8081");	
 

