import {
  EventDispatcher,
  Raycaster,
  Vector2,
  Vector3,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry
} from 'three';

var TranslateControls = function (camera, domElement, scene, renderer) {

  var scope = this;

  this.enabled = true;
  this.isTranslating = false;
  this.snap = 0;
  this.translateObjects = [];
  this.translateGroupObjects = [];
  this.object = null;
  this.handles = [];
  this.enableVertical = false;
  this.translateMode = 'horizontal';

  //virtual plane
  var planeGeometry = new PlaneGeometry(10000, 10000);
  var planeMaterial = new MeshBasicMaterial({wireframe: true, color: 0xE219EF, side: DoubleSide});
  var plane = new Mesh(planeGeometry, planeMaterial);
  plane.name = 'translation plane';
  plane.visible = false;
  plane.rotation.set(-Math.PI / 2, 0, 0);
  scene.add(plane);
  
  var raycast = new Raycaster();

  //pointer down
  this.pointerDown = function(e) {

    if (e.which != 1 && e.which != 3) { return false; }
    if (e.which == 3 && !scope.enableVertical) { return false; }

    var pointerPos = scope.parsePointerPos(e);

    //raycaster
    raycast.setFromCamera(pointerPos, camera);

    var intersectObjects = [];

    if (scope.handles.length > 0) {
      for (var i=0;i<scope.translateObjects.length;i++) {
        for (var j=0;j<scope.handles.length;j++) {
          if (scope.handles[j] in scope.translateObjects[i]) {
            var handle = scope.translateObjects[i][scope.handles[j]];
            handle.translateParent = scope.translateObjects[i];

            intersectObjects.push(handle);
          }
        }
      }
    }
    else {
      intersectObjects = scope.translateObjects;
    }

    var intersects = raycast.intersectObjects(intersectObjects, scope.handles.length > 0);      

    if (intersects.length > 0) {
      if ('translateParent' in intersects[0].object) {
        scope.object = intersects[0].object.translateParent;
      }
      else {
        scope.object = intersects[0].object;
      }

      if (scope.object == null) { return false; }

      scope.isTranslating = true;
      plane.position.copy(scope.object.position);

      if (!scope.translateGroupObjects.includes(scope.object)) {
        scope.translateGroupObjects = [scope.object];
      }

      for (var i=0;i<scope.translateGroupObjects.length;i++) {
        var point = intersects[0].point.clone();

        scope.translateGroupObjects[i].translateControls = {
          offsetPos: point.sub(scope.translateGroupObjects[i].position),
          originalPos: scope.translateGroupObjects[i].position.clone()
        }
      }

      if (e.which == 3 && scope.enableVertical) {
        scope.translateMode = 'vertical';
      }
      
      if (scope.translateMode == 'horizontal') {
        plane.rotation.set(-Math.PI / 2, 0, 0);
      }
      else {
        plane.lookAt(camera.position.x, scope.object.position.y, camera.position.z);
      }

      this.dispatchEvent( { type: 'translatestart' } );
    }
    else {
      scope.object = null;
    }
  }

  domElement.addEventListener('pointerdown', pointerDown, false);

  function pointerDown(e) {
    if (scope.enabled) {
      scope.pointerDown(e);
    }
  }

  //pointer move
  this.pointerMove = function(e) {

    if (this.object !== null && this.isTranslating) {
      
      var pointerPos = scope.parsePointerPos(e);      

      raycast.setFromCamera(pointerPos, camera);
      var intersects = raycast.intersectObjects([plane], false);      
      
      if (intersects.length > 0) {
        for (var i=0;i<scope.translateGroupObjects.length;i++) {
          var point = intersects[0].point.clone();
          var position = point.sub(scope.translateGroupObjects[i].translateControls.offsetPos);          

          if (scope.translateMode == 'horizontal') {
            position.y = scope.translateGroupObjects[i].translateControls.originalPos.y;
          }
          else {
            position.x = scope.translateGroupObjects[i].translateControls.originalPos.x;
            position.z = scope.translateGroupObjects[i].translateControls.originalPos.z;
          }          

          scope.translateGroupObjects[i].position.copy(position);
        }

        this.dispatchEvent( { type: 'translate' } );
      }
    }
  }

  domElement.addEventListener('pointermove', pointerMove, false);

  function pointerMove(e) {
    if (scope.enabled) {
      scope.pointerMove(e);
    } 
  }

  //pointer up
  this.pointerUp = function(e) {
    if (scope.object != null) {
      scope.isTranslating = false;

      if (e.which == 3 && scope.translateMode == 'vertical') {
        scope.translateMode = 'horizontal';
      }

      this.dispatchEvent( { type: 'translateend' } );
    }
  }

  domElement.addEventListener('pointerup', pointerUp, false);

  function pointerUp(e) {
    if (scope.enabled) {
      scope.pointerUp(e);
    }
  }

  this.parsePointerPos = function (event) {
    var cx = event.clientX;
    var cy = event.clientY;
    
    var mousePosition = new Vector2();

    // Use the canvas' bounding box (not offsetLeft/offsetWidth) so the viewer works when it is
    // embedded in a container that is not at the top-left of the page.
    var rect = domElement.getBoundingClientRect();

    mousePosition.x = ((cx - rect.left) / rect.width) * 2 - 1;
    mousePosition.y = -((cy - rect.top) / rect.height) * 2 + 1;

    return mousePosition;
  }
}

TranslateControls.prototype = Object.create( EventDispatcher.prototype );
TranslateControls.prototype.constructor = TranslateControls;

export { TranslateControls };