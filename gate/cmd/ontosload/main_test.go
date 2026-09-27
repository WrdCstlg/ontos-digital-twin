package main

import (
	"reflect"
	"testing"
)

// A mapping.listMappings answer as the server sends it: connectors carry their
// settings by name and say whether they hold inline data, never the data.
const mappingList = `{"result":{"data":{"json":[
  {"id":9,"name":"gate-bulk-2","connector":{"type":"csv","configJson":{"filename":"b.csv","hasInlineData":true,"hasPassword":false}}},
  {"id":3,"name":"HRIS people","connector":{"type":"csv","configJson":{"filename":"hris.csv","hasInlineData":true,"hasPassword":false}}},
  {"id":4,"name":"Upload pending","connector":{"type":"csv","configJson":{"filename":"x.csv","hasInlineData":false,"hasPassword":false}}},
  {"id":5,"name":"Contracts","connector":{"type":"sql","configJson":{"driver":"postgresql","hasInlineData":false,"hasPassword":true}}},
  {"id":6,"name":"Orphan","connector":null},
  {"id":7,"name":"gate-bulk-1","connector":{"type":"csv","configJson":{"hasInlineData":true,"hasPassword":false}}}
]}}}`

func TestRunnableFromListPicksCSVMappingsWithInlineData(t *testing.T) {
	ids, bulk, err := runnableFromList([]byte(mappingList))
	if err != nil {
		t.Fatal(err)
	}
	if want := []int64{3, 7, 9}; !reflect.DeepEqual(ids, want) {
		t.Fatalf("runnable ids = %v, want %v (sorted; CSV with inline data only)", ids, want)
	}
	if want := map[int64]bool{7: true, 9: true}; !reflect.DeepEqual(bulk, want) {
		t.Fatalf("bulk = %v, want %v", bulk, want)
	}
}

func TestRunnableFromListRefusesAnAnswerItCannotRead(t *testing.T) {
	if _, _, err := runnableFromList([]byte(`{"result":`)); err == nil {
		t.Fatal("a truncated answer decoded without error")
	}
}
