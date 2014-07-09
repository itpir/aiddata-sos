var csv = require('csv');
var url = require('url');
var S = require('string');
var ss = require('simple-statistics');
var md5 = require('MD5');
var natural = require('natural');
var keyword_extractor = require("keyword-extractor");
var bayes = require('bayes');
var cluster = require('cluster');
var fs = require('graceful-fs');
var http = require('http');

var classifierDir = process.argv[2]; //directory containing the json files to load the classifier with

var numCPUs = require('os').cpus().length;

console.log("CPUS: "+numCPUs);

var gsz = 0;
var gFiles, gF = 0;

var weakClassifiers = [];
var training_data = [];
var total_count = 0;

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

function populateClassifiers(err,files)
{
	gFiles = files.length;
	gF = gFiles;
	for (c = 0; c < files.length; c++)
	{
		var cl = new natural.BayesClassifier();
		fn = classifierDir+files[c];
		cl.fn = fn;
		
		fs.readFile(fn, function (err, data) 
		{
			if (err) throw err;
			var myClass = JSON.parse(data.toString());
		  	var cl = natural.BayesClassifier.restore(myClass);
		  	cl.act_code = myClass.act_code;
			console.log("Restored: "+ cl.act_code);
		  	weakClassifiers.push(cl);
		  	gFiles--;
		  	if (gFiles == 0)
		  	{
		  		console.log("Done Loading.");
		  	}
		});
	
	}

}

function featureSelect (text)
{
	var txtArr = keyword_extractor.extract(text,{
			language:"english",
			return_changed_case:false
		});
	
	text = '';
	for (g = 0; g < txtArr.length; g++)
	{
		text += txtArr[g]+' ';
	} 
	return txtArr;
	
}

function getCodesbyJenks(votes, classes)
{
	var ar = [];
	var ans = [];
	for (var y = 0;  y < votes.length; y++)
	{
		ar.push(votes[y].value);
	}
	
	var std = ss.standard_deviation(ar);
	if (std > 0)
	{
		var jenks = ss.jenks(ar, classes);
		var f = 0;
		while (f < votes.length && (votes[f].value >= jenks[0] &&  votes[f].value <= jenks[1]))
		{
			ans.push(votes[f]);
			console.log(votes[f]);
			f++;	
		}
	}
	else
	{
		ans = votes;
	}
	
	return ans;
	
}


function everybodyVotes(classVoters,input_string)
{
	var ans = [];
	
	var allvotes = [];
	for (var v = 0; v < classVoters.length; v++)
	{
		allvotes.push(classVoters[v][0]);
		allvotes[v].act_code = 	classVoters[v].act_code;
	}

	allvotes.sort(function(a, b){
				return a.value-b.value;
			});
		
	return allvotes;

}


function cleanText (text)
{
	text = text.replace(/[\.,-\/#!$%\^&\*;:{}=\-_`~()]/g," ");
	text = S(text).stripTags().s;
 	text = S(text).humanize().s
 	text = text.toLowerCase(text);
 
 	return text;
}


fs.readdir(classifierDir, populateClassifiers);

http.createServer(function(req,res){

	var body = "";
	req.on('data', function (chunk) {
		body += chunk;
	});

	//parse the input string, get text, sector, donor and recipient
	var queryData = url.parse(req.url, true).query;
	orig_input_string = queryData.description;			//get the text to classify from the querystring
	id = queryData.id;

	mode = queryData.mode;
	thold = queryData.thold;
	input_string = cleanText(orig_input_string);

	//handle request
	req.on('end', function () {

		//answer array
		var ans =[];
		
		//check to see if the classifier is ready (has read all the training input)
	
		console.log("Project: " +id);
			
		//if we have all of our good classes to attempt classification with
		var classVoters = [];

		for (var r = 0; r < weakClassifiers.length; r++)
		{
			txt = featureSelect(input_string);
			test = weakClassifiers[r].getClassifications(txt);
			test.act_code =  weakClassifiers[r].act_code;
			classVoters.push(test);	
		}		
	
		var votes = everybodyVotes(classVoters, input_string);
		var f = (Math.floor(gF/20)+1);
		
		ans = getCodesbyJenks(votes, f);
	
		res.writeHeader(200, {"Content-Type": "text/json"});
		res.write(JSON.stringify(ans));
		console.log("\t-----------------------------------------------");				
		
		res.end();
});

}).listen(8081);
	
	
 


