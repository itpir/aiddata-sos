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
var thisClassifier = null;

function findClassifier(hk)
{
	var retval = -1;
	for (var y = 0; y < aClassifiers.length; y++)
	{
		if (aClassifiers[y].hash == hk)
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
    	    if (key == 'act_code')
    	    {
    	    	act_code = (data[key]);
    	     
    		}
    	    if (key == 'org')
    	    {
    	    	donor = (data[key]);
    	    }
    	     if (key == 'project_id')
    	    {
    	    	project_id = (data[key]);
    	    }
    	    if (key == 'recipient')
    	    {
    	    	recipient = (data[key]);
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
				var test;
				var szClass = 'Donor + Recipient';
				var classKey =  donor + recipient;
				var nCodes = 0;
				var nProjectsCodes = [];
				var training_size = 0;
				var nProjs = 0;
				thisClassifier = null;
				var thisData;
				
				while (!thisClassifier)
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
							if (findClassifier(hk) < 0) 
							{
								aClassifiers.push(bayes());
								var i = aClassifiers.length - 1;
								aClassifiers[i].hash = hk;
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
							thisClassifier = aClassifiers[i];
						}
						else
						{
							console.log("\tNot enough codes for: "+classKey+". Needed "+nCodesThreshold+", got "+training_size);
							if (szClass == 'Donor + Recipient')
							{
								classKey = donor;
								console.log("\tTrying Donor Only Class for: "+classKey);
								szClass = 'Donor';
								var t =  findClassifier(hk);
								if (t >= 0)
								{
									console.log("\Classifier Exists For: "+classKey);	
									thisClassifier = aClassifiers[t];
								}
								else
								{
									console.log("\tMust Create Classifier for: "+classKey);	
								}
								
							}
							else
							{	
								console.log("\tUsing Default Classifier for: "+classKey);
								test = classifier.categorize_list(input_string);
								thisClassifier = classifier;
							}
						}
					}
					else
					{
						thisClassifier = aClassifiers[findClassifier(hk)];
					}
				}
				//if we have a good class to attempt classification with
				if (thisClassifier)
				{
					var arCodes = [];
					test = thisClassifier.categorize_list(input_string);
					console.log("\t\tProjects: "+thisClassifier.numProjects);
					console.log("\t\tCodes: "+thisClassifier.training_size);
					nAvgCodes = thisClassifier.training_size/thisClassifier.numProjects;
					// get codes
					for (var key in thisClassifier.nProjectsCodes) 
					{
						if (thisClassifier.nProjectsCodes.hasOwnProperty(key))
							arCodes.push(thisClassifier.nProjectsCodes[key]);
					}
					ci = arCodes.stdDeviation(thold/100.0);
					console.log("\t\tConfidence Interval for Code Lengths: "+nAvgCodes);
					nMaxCodes = Math.round(nAvgCodes + ci.upper);
					nMinCodes = Math.max(Math.round(nAvgCodes - ci.lower),1);
					console.log("\t\tAvg. Code length: "+nAvgCodes);
					console.log("\t\tMin. Code length: "+nMinCodes);
					console.log("\t\tMax. Code length: "+nMaxCodes);
					thisClassifier.codelength = nAvgCodes;
					thisClassifier.maxcodelength = nMaxCodes;
					thisClassifier.mincodelength = nMinCodes;
					
					console.log("\tUsing A Classifier For: "+classKey);
					test = thisClassifier.categorize_list(input_string);
					nAvgCodes = thisClassifier.codelength ;
					nCodeLength = thisClassifier.codelength ;
					nMaxCodes = thisClassifier.maxcodelength ;
					nMinCodes = thisClassifier.mincodelength ;

					//sort by probability
					test.sort(function(a, b){
						return b.probability-a.probability
					});

					// get length of codes to report out TODO: this needs work, its only the average	
					var count = Math.round(nCodeLength);
		
					for (var y = 0; y < count; y++)
					{	
						if (typeof test[y] != 'undefined')
						{
							ans.push(test[y].category);
							nCodes++;
						}
			
					}
				}
				
			}
			else
			{
				ans = "Classifier Not Ready; still training";
			}
			res.writeHeader(200, {"Content-Type": "text/json"});
			res.write(JSON.stringify(ans));
			res.end();
	});

}).listen(8081);
sys.puts("Server Running on 8081");	
 
