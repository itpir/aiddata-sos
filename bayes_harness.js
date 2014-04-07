var csv = require('csv');
var url = require('url');
var S = require('string');

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
 		var rec = {
    		act_code: act_code,
    		sector: sector,
    		donor: donor,
    		super_sector: super_sector,
    		title: title,
    		short_desc: short_desc,
    		long_desc: long_desc,
		}
 		//save record in training data
 		training_data.push(rec);
 		var text = S(strRow).stripTags().s;
 		text = S(text).stripPunctuation().s;
 		text = text.toLowerCase(text);
 
 		//if doc length greater than length, tokenize using TF*IDF
 		if (text.length > tlen)
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
			
			//check if we should reset the TF*IDF//
			if ((doc % nDocsReset) == 0)
			{
				//console.log ("\tReseting TF*IDF doc repo...");
				tfidf = new TfIdf();
				doc = 0;
			}
 		}
 		else
 		{
 			//console.log("Training on short document #"+short_doc);
 			short_doc++;
 		}
 		
 			//the default classifier
 			classifier.learn(text, act_code); 
 		
 	}
 })
 .on('end', function(count){
    var s = JSON.stringify(tfidf);
 	console.log("Done Training: Total Records: "+count);
 	console.log("-----------BELOW THIS LINE IS TF-IDF SERIALIZED-------------")
 	console.log(s);
 	var sys = require("sys");
	
	
})

var sys = require("sys");
	
	var my_http = require("http");
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
  		var bDSClass = false;
  		req.on('end', function () {
    		
    		var len = input_string.length;
    		var test;
    		
    		//test = classifier.categorize_list(input_string);
    		if (!(donor in aClassifiers))
    		{
    			aClassifiers[donor] = bayes();
    			console.log("\tCreating Donor Specific Coder for: "+donor);
    			doc = 0;	
    			var tfidf_spec = new TfIdf();
    			previous_text = '';
    			for (var y = 0; y < training_data.length; y++)
    			{
    				if (training_data[y].donor == donor)
    				{
    					
    					//console.log("\tTraining Donor Specific Coder for: "+donor);
    					var text =  training_data[y].title+" "+ training_data[y].short_desc+" "+training_data[y].long_desc;
    					
    					var text = S(text).stripTags().s;
 						text = S(text).stripPunctuation().s;
 						text = text.toLowerCase(text);
 
 						//if doc length greater than length, tokenize using TF*IDF
 						if ((text.length > tlen) && (text != previous_text))
 						{
 							tfidf_spec.addDocument(text);
 							var i =0;
 							text = '';
 							tfidf_spec.listTerms(doc).forEach(function(item) {
 			    				i++;
								if( i <= tokcount)
								{
									text += item.term+' '; 
								}
						});
						previous_text = text;					
						doc++;
						
						//check if we should reset the TF*IDF//
						if (((doc+1) % nDocsReset) == 0)
						{
							//console.log ("\tReseting TF*IDF doc repo...");
							tfidf_spec = new TfIdf();
							doc = 0;
						}
 					}
    					aClassifiers[donor].learn(text,  training_data[y].act_code);
    					bDSClass = true;
    				}	
    			}
    			//aClassifiers[donor] = classifier_0;
    			console.log("\tDone.");
    			if (bDSClass)
    			{
    				console.log("\tUsing Donor Specific Coder for: "+donor);
    				test = aClassifiers[donor].categorize_list(input_string);
    			}
    			else
    			{
    				aClassifiers[donor] = null;
    				console.log("\tUsing Default Classifier for: "+donor);
    				test = classifier.categorize_list(input_string);
    			}
    		}
    		else
    		{
    			//console.log(aClassifiers[donor]);
    			if (aClassifiers[donor])
    			{
    				console.log("\tUsing Donor Specific Coder for: "+donor);
    				test = aClassifiers[donor].categorize_list(input_string);
    			}
    			else
    			{
    				console.log("\tUsing Default Classifier for: "+donor);
    				test = classifier.categorize_list(input_string);
    			}
    		}
    		
    		
    		test.sort(function(a, b){
 				return a.probability-b.probability
			});
	
			test.sort();
			l = test.length;
			max_p = test[l-1].probability;
			threshold = max_p/thold;
    
    		var ans =[];
    		for (var y = 0; y < l; y++)
    		{	
    	
    			if (test[y].probability >= (threshold))
    			{
    				ans.push(test[y].category);
    			}
    		}
    		res.writeHeader(200, {"Content-Type": "text/json"});
    		res.write(JSON.stringify(ans));
    		res.end();
  		});
	
	}).listen(8081);
	sys.puts("Server Running on 8081");	
 

