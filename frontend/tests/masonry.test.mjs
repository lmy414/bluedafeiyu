import test from 'node:test';
import assert from 'node:assert/strict';
import {masonryPositions} from '../src/scripts/masonry.mjs';
import {initialMasonryScript,justifiedPositions} from '../src/components/layout/Masonry.mjs';
import {createWorkCards} from '../src/components/archive/WorkCards.mjs';
import vm from 'node:vm';

test('initial layout uses resolved CSS tracks instead of stale viewport column hints',()=>{
  const items=[100,200,50].map(offsetHeight=>({offsetHeight,hidden:false,matches:()=>true}));
  const grid={children:items,clientWidth:412,classList:{add:value=>assert.equal(value,'is-laid-out')}};
  let placed;
  vm.runInNewContext(initialMasonryScript().replace(/^<script>|<\/script>$/g,''),{
    document:{currentScript:{previousElementSibling:grid}},
    getComputedStyle:()=>({gridTemplateColumns:'200px 200px',getPropertyValue:key=>key==='--columns'?'6':'12px'}),
    SiteComponents:{masonryWidth:(nodes,width)=>{assert.equal(nodes.length,3);assert.equal(width,200);},masonryPlace:(_grid,_items,result)=>{placed=JSON.parse(JSON.stringify(result));}}
  });
  assert.deepEqual(placed,masonryPositions([100,200,50],2,200,12));
});

test('unequal images pack into the shortest column instead of aligned rows',()=>{
  const result=masonryPositions([100,200,150,80,120],3,200,16);
  assert.deepEqual(result.positions,[{left:0,top:0},{left:216,top:0},{left:432,top:0},{left:0,top:116},{left:432,top:166}]);
  assert.equal(result.height,286);
});

test('justified rows use image dimensions before loading and leave other initial grids unchanged',()=>{
  const items=Array.from({length:3},()=>({hidden:false,matches:()=>true,querySelector:()=>({naturalWidth:0,naturalHeight:0,getAttribute:()=>100})}));
  const grid={children:items,clientWidth:620,classList:{add:value=>assert.equal(value,'is-laid-out')}};
  let placed;
  vm.runInNewContext(initialMasonryScript('justified').replace(/^<script>|<\/script>$/g,''),{
    document:{currentScript:{previousElementSibling:grid}},
    getComputedStyle:()=>({getPropertyValue:key=>key==='--gap'?'10px':'200px'}),
    SiteComponents:{justifiedPlace:(_grid,nodes,result)=>{assert.equal(nodes.length,3);placed=JSON.parse(JSON.stringify(result));}}
  });
  assert.deepEqual(placed,{positions:[{left:0,top:0,width:200,height:200},{left:210,top:0,width:200,height:200},{left:420,top:0,width:200,height:200}],height:200});
  assert.doesNotMatch(initialMasonryScript(),/justified|workAspectRatios/);
});

test('home variant keeps card identity, order and real links without changing default grids',()=>{
  const work={id:'stable-id',slug:'frozen',n:'Work',i:'/thumb.jpg',p:[1600,900],k:[],roles:[]};
  const {grid}=createWorkCards();
  assert.doesNotMatch(grid([work]),/work-grid--justified/);
  const html=grid([work],'',2,{layout:'justified'});
  assert.match(html,/work-grid--justified/);
  assert.match(html,/data-slug="frozen"/);
  assert.match(html,/href="\/works\/frozen.html"/);
  assert.match(html,/width="1600" height="900"/);
});

test('mixed wide and portrait images retain their ratios in compact, non-overlapping equal-height rows',()=>{
  const ratios=[16/9,9/16,1,16/9,4/5,1,16/9,9/16,3/2,1,9/16,16/9];
  for(const [width,target,gap] of [[1234,180,6],[1000,180,6],[358,120,4],[288,120,4]]){
    const result=justifiedPositions(ratios,width,target,gap);
    const rows=Map.groupBy(result.positions,point=>point.top);
    result.positions.forEach((point,i)=>{
      assert.ok(point.width>0&&point.height>0);
      assert.ok(Math.abs(point.width/point.height-ratios[i])<1e-10);
      assert.ok(point.left>=0&&point.left+point.width<=width+1e-8);
    });
    const entries=[...rows];
    entries.forEach(([top,row],index)=>{
      assert.equal(row[0].left,0);
      row.forEach((point,i)=>{
        assert.equal(point.height,row[0].height);
        if(i)assert.ok(Math.abs(point.left-row[i-1].left-row[i-1].width-gap)<1e-8);
      });
      if(index<entries.length-1){
        assert.ok(Math.abs(row.at(-1).left+row.at(-1).width-width)<1e-8);
        assert.ok(Math.abs(entries[index+1][0]-top-row[0].height-gap)<1e-8);
      }else assert.ok(row[0].height<=target);
    });
    assert.ok(Math.abs(result.height-result.positions.at(-1).top-result.positions.at(-1).height)<1e-8);
  }
});

test('short final rows keep their natural size rather than stretching a lone portrait',()=>{
  assert.deepEqual(justifiedPositions([9/16],1000,180,6),{positions:[{left:0,top:0,width:101.25,height:180}],height:180});
  assert.deepEqual(justifiedPositions([],1000,180,6),{positions:[],height:0});
  assert.deepEqual(justifiedPositions([1],0,180,6),{positions:[],height:0});
  const invalid=justifiedPositions([0,NaN,Infinity,1/20,20],288,120,4);
  assert.ok(invalid.positions.every(point=>Object.values(point).every(Number.isFinite)));
});
test('appending cards keeps existing positions and never overlaps at phone or desktop widths',()=>{
  const heights=[120,400,230,95,300,180,210,100];
  for(const columns of [2,4,6]){
    const before=masonryPositions(heights.slice(0,4),columns,160,12);
    const after=masonryPositions(heights,columns,160,12);
    assert.deepEqual(after.positions.slice(0,4),before.positions);
    after.positions.forEach((a,i)=>after.positions.slice(i+1).forEach((b,j)=>{
      if(a.left===b.left)assert.ok(b.top>=a.top+heights[i]+12);
    }));
    assert.equal(masonryPositions([],columns,160,12).height,0);
  }
});
