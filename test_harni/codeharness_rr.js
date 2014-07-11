

var csv = require('csv');
var http = require('http');
var request = require("request");
var S = require('string');

var autocoderURL = process.argv[2]; //the url to the autocoding service, such as: http://localhost:3000/classify.json
var csvfile = process.argv[3]; 		//get the filename from the command line
var thold = process.argv[4]; 		//get the threshold value from the command line
var mode = process.argv[5]; 		//get the MAD threshold value from the command line
var totalScore = 0;
var possTotal = 0;
var doc = 0;
var start = +new Date();  // log start timestamp

var totalThreshold = 0;

process.stdout.write("id\ttext\thuman_codes\trobo_codes\tlog diff\tdoc_length\tround_score\tpossible_score\trunning_total_possible\trunning_total_score\tpercent_of_possible\r\n");
    

//we need at least the csvfile
if (!csvfile || !autocoderURL  )
{
	console.log ("Missing Parameters, example:");
    console.log("node codeharness.js http://localhost:3000/classify.json \"../data sets/aiddata22_WB500.txt");
	process.exit(1);
}

function intersect(a, b,info) 
{
    var results = [];

	var max = -1;
	for (var i = 0; i < a.length; i++) {
        for (var j = 0; j < b.length; j++) {
        	if (b[j].trim()==(a[i].trim())) {
        		max = j;
            	results.push(a[i]);
        	}
        }
    }
    return results;
}

csv()
.from.path(csvfile, { columns: true, delimiter: "," } )


// on each record, populate the map and check the codes
.on('record', function (data, index)
{
	id = data.aiddata_id;
	title = data.title;
	short_description = data.short_description;
	long_description = data.long_description;

	total_desc = title+' '+short_description+' '+long_description;

	if (data.aiddata_activity_code)
	{
		var codes = data.aiddata_activity_code.split("|");
		codes = codes.map(function (val) { return val; });
	}
	else
	{
		codes = '';
	}
	
	var options =
	{
    	url: autocoderURL + '?description='+total_desc+'&thold='+thold+"&id="+id+'&mode='+mode,
    	codes:  codes,
    	len: total_desc.length,
    	total_desc: total_desc,
    	id: id
	};
	

	function callback(error, response, body)
	{
    	if (!error && response.statusCode == 200) {
    		
    
    		//console.log(info);
        	var info = JSON.parse(body);
        	reported_codes = info.length;
        	id = this.req.res.request.id;
        	var robo_codes = [];
        	for (y = 0; y < reported_codes; y++)
        	{
        		robo_codes.push(info[y].act_code);
        	}
        	
			process.stdout.write(JSON.stringify(id));
			process.stdout.write('\t');
			//process.stdout.write(JSON.stringify(robo_codes));
			for (y = 0; y < reported_codes; y++)
        	{
        		process.stdout.write(info[y].act_code);
        		if ((y+1) < reported_codes)
        			process.stdout.write('|');	
        		//robo_codes.push(info[y].act_code);
        	}
			process.stdout.write('\r\n');
    	}
	}
	
	request(options, callback);
})


.on('end', function(count){
  
   var end =  +new Date();  // log end timestamp
   var diff = end - start;
   
   diff = diff/1000.0;
   console.log("Took "+diff+ " seconds to read "+count+" records.");

 	
});
