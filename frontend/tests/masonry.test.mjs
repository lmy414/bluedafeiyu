import test from 'node:test';
import assert from 'node:assert/strict';
import {masonryPositions} from '../src/scripts/masonry.mjs';

test('unequal images pack into the shortest column instead of aligned rows',()=>{
  const result=masonryPositions([100,200,150,80,120],3,200,16);
  assert.deepEqual(result.positions,[{left:0,top:0},{left:216,top:0},{left:432,top:0},{left:0,top:116},{left:432,top:166}]);
  assert.equal(result.height,286);
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
