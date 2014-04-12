var csv = require('csv');
var url = require('url');
var S = require('string');
var StatsArray = require('stats-array')


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


function cleanText (text)
{
	text = S(strRow).stripTags().s;
 	text = S(text).stripPunctuation().s;
 	text = text.toLowerCase(text);
 	
 	return text;
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
    	     	super_sector = act_code.substr(0,1);
    	     	sector = act_code.substr(0,3);
    	     	
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
    		sector: sector,
    		donor: donor,
    		project_id : project_id,
    		recipient: recipient,
    		super_sector: super_sector,
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
		//var classifier_0 = bayes();
  		req.on('data', function (chunk) {
    		body += chunk;
  		});
  		
  		//parse the input string, get text, sector, donor and recipient
  		var queryData = url.parse(req.url, true).query;
  		input_string = queryData.description;
  		sector = queryData.sector;
  		donor = queryData.donor;
  		recipient = queryData.recipient;
  		var bDSClass = false;
  		req.on('end', function () {
    		
    		if (bReady)
    		{
				var len = input_string.length;
				var test;
				var szClass = 'Donor + Recipient';
				var classKey =  donor + recipient;
				var nCodes = 0;
				var nProjectsCodes = [];
				var training_size = 0;
				var nProjs = 0;
				bDSClass = false;
			
				while (!bDSClass)
				{
				
					//if we dont already have a classifier for this class
				
					if (!(classKey  in aClassifiers))
					{
						console.log("\tCreating Class Specific Coder for: "+classKey);
						doc = 0;	
						var tfidf_spec = new TfIdf();
						previous_text = '';
					
						//count training size
						for (var y = 0; y < training_data.length; y++)
						{
							//set key
							if (szClass == 'Donor + Recipient')
							{
								thisKey =  training_data[y].donor +training_data[y].recipient;
							}
							else  if (szClass == 'Donor') 
							{
								thisKey =  training_data[y].donor;
							}
							if (thisKey == classKey)
							{
								training_size++;
							}
						
						}
					
						if (training_size > nCodesThreshold)
						{
							for (var y = 0; y < training_data.length; y++)
							{
								//set key
								if (szClass == 'Donor + Recipient')
								{
									thisKey =  training_data[y].donor +training_data[y].recipient;
								}
								else  if (szClass == 'Donor') 
								{
									thisKey =  training_data[y].donor;
								}
								if (thisKey == classKey)
								{
									// create the classifier
									if (!aClassifiers[classKey]) 
									{
										aClassifiers[classKey] = bayes();
									}
									// keep track of codes per project
									if (!nProjectsCodes[training_data[y].project_id])
									{
										nProjectsCodes[training_data[y].project_id] = 1;
										nProjs  = nProjs + 1;
				
									}
									else
									{
										nProjectsCodes[training_data[y].project_id]++;
									}
						
									//learn the project/codes
									var text =  training_data[y].text;			
									aClassifiers[classKey].learn(text,  training_data[y].act_code);
									bDSClass = true;
								}	
							}
						}
				
					//if we have a good class to attempt classification with
					if (bDSClass)
					{
						var arCodes = [];
						console.log("\tUsing Class Specific Coder for: "+classKey);
						test = aClassifiers[classKey].categorize_list(input_string);
						console.log("\t\tProjects: "+nProjs);
						console.log("\t\tCodes: "+training_size);
						nAvgCodes = training_size/nProjs;
						// get codes
						for (var key in nProjectsCodes) 
						{
							if (nProjectsCodes.hasOwnProperty(key))
								arCodes.push(nProjectsCodes[key]);
						}
						ci = arCodes.stdDeviation(thold/100.0);
						console.log("\t\tConfidence Interval for Code Lengths: "+nAvgCodes);
						nMaxCodes = Math.round(nAvgCodes + ci.upper);
						nMinCodes = Math.max(Math.round(nAvgCodes - ci.lower),1);
						console.log("\t\tAvg. Code length: "+nAvgCodes);
						console.log("\t\tMin. Code length: "+nMinCodes);
						console.log("\t\tMax. Code length: "+nMaxCodes);
						aClassifiers[classKey].codelength = nAvgCodes;
						aClassifiers[classKey].maxcodelength = nMaxCodes;
						aClassifiers[classKey].mincodelength = nMinCodes;
						aClassifiers[classKey].usable = true;
						console.log("\tDone.");
						nCodeLength = aClassifiers[classKey].codelength;
					}
					else
					{
						//aClassifiers[classKey] =  null;
						// check to see if we can use a bigger class
						if (szClass == 'Donor + Recipient')
						{
							classKey = donor;
							console.log("\tTrying Donor Only Class for: "+classKey);
							szClass = 'Donor';
						}
						else
						{	
							console.log("\tUsing Default Classifier for: "+classKey);
							test = classifier.categorize_list(input_string);
							bDSClass = true;
							nCodeLength = classifier.codelength;
						}
					}
					}
				else
				{
					if (aClassifiers[classKey])
					{
						if (aClassifiers[classKey].usable)
						{
							console.log("\tUsing Class Specific Coder for: "+classKey);
							test = aClassifiers[classKey].categorize_list(input_string);
							bDSClass = true;
							nAvgCodes = aClassifiers[classKey].codelength ;
							nCodeLength = aClassifiers[classKey].codelength ;
							nMaxCodes = aClassifiers[classKey].maxcodelength ;
							nMinCodes = aClassifiers[classKey].mincodelength ;
					
						}
						else
						{
							console.log('\tClass Specific Coder is Not usable');
					
							if (szClass == 'Donor + Recipient')
							{
								classKey = donor;
								console.log("\tTrying Donor Only Class for: "+classKey);
								szClass = 'Donor';
							}
							else
							{	
								console.log("\tUsing Default Classifier for: "+classKey);
								test = classifier.categorize_list(input_string);
								bDSClass = true;
								nCodeLength = classifer.codelength;
							}
					
						}
					}
					else
					{
						console.log("\tUsing Default Classifier for: "+classKey);
						test = classifier.categorize_list(input_string);
						bDSClass = true;
						nCodeLength = classifier.codelength;
					}
				}
			}
		
		
			//sort by probability
			test.sort(function(a, b){
				return b.probability-a.probability
			});


			l = test.length;
			max_p = test[l-1].probability;
			threshold = max_p/thold;
			var ans =[];
			nCodes = 0;
		
			var count = Math.round(nCodeLength);
			//find the codes we want to use
			//count = Math.round(nCodeLength);
			//if ( nCodeLength > nMaxCodes)
			//{
			//	count = nMaxCodes;
			//}
			//if ( count < nMinCodes)
			//{
			//	count = nMinCodes;
			//}
		
		
			for (var y = 0; y < count; y++)
			{	
				if (typeof test[y] != 'undefined')
				{
					ans.push(test[y].category);
					nCodes++;
				}
			
			}
			res.writeHeader(200, {"Content-Type": "text/json"});
			res.write(JSON.stringify(ans));
			res.end();
		}
		else
		{
			res.writeHeader(200, {"Content-Type": "text/json"});
			res.write(JSON.stringify("Classifier Not Ready"));
			res.end();
		}
	});

}).listen(8081);
sys.puts("Server Running on 8081");	
 

