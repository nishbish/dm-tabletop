import {
  EventDispatcher,
  BoxGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Raycaster,
  Vector2,
  Vector3,
  PlaneGeometry
} from 'three';

var ScaleControls = function (camera, domElement, scene, renderer) {

  var scope = this;

  // replaced by the viewer when it switches between the 3D and the 2D view
  this.camera = camera;
  this.enabled = true;
  this.isScaling = false;
  this.object = null;
  this.snap = 0;
  this.size = 0.4;
  this.color = 0xffffff;
  this.uniform = true;

  this.container = new Object3D();
  this.container.visible = false;
  scene.add(this.container);

  //scale controls
  var geometry = new BoxGeometry( this.size, this.size / 4, this.size );
  var material = new MeshBasicMaterial( {color: this.color} );
  
  var scalePoints = [];
  var scalePointsLength = 9;

  for (var i=0;i<scalePointsLength;i++) {
    var cube = new Mesh( geometry, material );
    cube.name = 'scale cube';
    scalePoints.push(cube);

    //skip center point
    if (i != 4) {
      this.container.add(cube);
    };
  }

  //virtual plane
  var planeGeometry = new PlaneGeometry(10000, 10000);
  var planeMaterial = new MeshBasicMaterial({wireframe: true, color: 0xE219EF});
  var plane = new Mesh(planeGeometry, planeMaterial);
  plane.name = 'scale plane';
  plane.visible = false;
  plane.rotation.set(-Math.PI / 2, 0, 0);
  scene.add(plane);
      
  var activeScalePointIndex = null;
  var scaleOrigin = new Vector3();
  var globalScaleOrigin = new Vector3();
  var scaleStart = new Vector3();
  var scalePivot = new Vector3();
  var posOrigin = new Vector3();
  var prevPos = new Vector3();
  var raycast = new Raycaster();

  //attach event
  this.attach = function ( object ) {      
    scope.visible = true;
    scope.object = object;

    //3d
    plane.position.copy(object.position);
    plane.rotation.z = object.rotation.z;

    scope.container.visible = true;
    scope.updatePosition();

    return this;
  };

  //detach event
  this.detach = function ( object ) {
    scope.visible = false;
    scope.object = null;
    scope.container.visible = false;

    return this;
  };

  //pointer down
  this.pointerDown = function(e) {

    if (scope.object != null) {
      var pointerPos = scope.parsePointerPos(e);

      //raycaster
      raycast.setFromCamera(pointerPos, scope.camera);
      // a new list each time: pushing onto scalePoints itself grew it by one on every click
      var rayObjects = scalePoints.concat([plane]);
      var intersects = raycast.intersectObjects(rayObjects, true);

      var cubeIntersected = false;
      var planeIntersected = false;

      for (var i=0;i<intersects.length;i++) {
        if (intersects[i].object.name == 'scale cube') {
          activeScalePointIndex = scalePoints.indexOf(intersects[i].object);
          posOrigin.copy(scope.object.position);
          scaleStart.copy(scope.object.scale);
          cubeIntersected = true;

          prevPos.copy(scope.object.scale);
        }
        
        if (intersects[i].object.name == 'scale plane') {
          globalScaleOrigin.copy(intersects[i].point);
          scaleOrigin.copy(intersects[i].point);
          plane.worldToLocal(scaleOrigin);
          planeIntersected = true;
        }
      }

      if (cubeIntersected && planeIntersected) {
        scope.isScaling = true;
        this.dispatchEvent( { type: 'scalestart' } );
      }
    }
  }

  domElement.addEventListener('pointerdown', pointerDown, false);

  function pointerDown(e) {
    if (e.which === 1 && scope.enabled) {
      scope.pointerDown(e);
    }
  }

  //pointer up
  this.pointerUp = function(e) {
    // only the end of an actual scale counts; every other click on the page used to send the
    // plane's transform again and clear the group selection
    if (scope.object != null && scope.isScaling) {
      scope.isScaling = false;

      this.dispatchEvent( { type: 'scaleend' } );
    }
  }

  domElement.addEventListener('pointerup', pointerUp, false);

  function pointerUp(e) {
    if (scope.enabled) {
      scope.pointerUp(e);
    }
  }

  //pointer move
  this.pointerMove = function(e) {
    if (this.object !== null && this.visible && this.isScaling) {
      
      var pointerPos = scope.parsePointerPos(e);

      raycast.setFromCamera(pointerPos, scope.camera);
      var intersects = raycast.intersectObjects([plane], false);

      if (intersects.length > 0) {
        var scalePosition = intersects[0].point.clone();
        plane.worldToLocal(scalePosition);

        var diffX = scalePosition.x - scaleOrigin.x;
        var diffY = scalePosition.y - scaleOrigin.y;   

        if (activeScalePointIndex > 5 || activeScalePointIndex == 3) {
          diffX *= -1;
          diffY *= -1;
        }

        var scaleFactor = 0.2;

        var startPos = new Vector3();
        scalePoints[8 - activeScalePointIndex].getWorldPosition(startPos);

        var endPos = new Vector3();
        scalePoints[activeScalePointIndex].getWorldPosition(endPos);        

        if (this.uniform) {
          this.object.scale.x = scaleStart.x + (diffX * scaleFactor);
          this.object.scale.y = scaleStart.y + (diffY * scaleFactor);
  
          if (activeScalePointIndex < 3 || activeScalePointIndex > 5) {   //vertical scale
            this.object.scale.x = this.object.scale.y;
          }
          else {    //horizontal scale
            this.object.scale.y = this.object.scale.x;
          }
        } else {
          if (activeScalePointIndex < 3 || activeScalePointIndex > 5) {   //vertical scale
            this.object.scale.y = scaleStart.y + (diffY * scaleFactor);          
          }
          else {    //horizontal scale
            this.object.scale.x = scaleStart.x + (diffX * scaleFactor);
          }
  
          if (activeScalePointIndex % 2) {    //sides
              if ([1,7].includes(activeScalePointIndex)) {
                this.object.scale.y = scaleStart.y + (diffY * scaleFactor);
              } else if ([3,5].includes(activeScalePointIndex)) {
                this.object.scale.x = scaleStart.x + (diffX * scaleFactor);
              }
          } else {    //corners
            
            if ([0,8].includes(activeScalePointIndex)) {
              this.object.scale.x = scaleStart.x + (diffX * scaleFactor * -1);
            } else {
              this.object.scale.x = scaleStart.x + (diffX * scaleFactor);
            }
  
            this.object.scale.y = scaleStart.y + (diffY * scaleFactor); 
          }
        }

        var translateX = (this.object.scale.x - prevPos.x) * 2.5;
        var translateY = (this.object.scale.y - prevPos.y) * 2.5;

        this.object.translateX(translateX * (-1 + activeScalePointIndex%3));
        this.object.translateY(translateY * (1 - parseInt(activeScalePointIndex/3)));

        scope.updatePosition();

        prevPos.copy(this.object.scale);

        this.dispatchEvent( { type: 'scale' } );
      }
    }
  }

  domElement.addEventListener('pointermove', pointerMove, false);

  function pointerMove(e) {
    if (scope.enabled) {
      scope.pointerMove(e);
    }
  }

  this.updatePosition = function() {
    setTimeout(function() {
      if (scope.object != null) {
        scope.container.position.copy(scope.object.position);
        scope.container.rotation.y = scope.object.rotation.z;

        var planeSize = new Vector3(scope.object.geometry.parameters.width * scope.object.scale.x, 0, scope.object.geometry.parameters.height * scope.object.scale.y);

        for (var i=0;i<scalePointsLength;i++) {
          if (scalePoints[i] != null) {
            var cube = scalePoints[i];
            var cubePos = new Vector3(i%3, 0, parseInt(i/3));
            cube.position.set(0, 0, 0);
            cubePos.multiply(planeSize);
            cubePos.sub(planeSize);
            cube.position.addScaledVector(cubePos, 0.5);

            cube.translateX((1 - i%3) * (scope.size / 2));
            cube.translateZ((1 - parseInt(i/3)) * (scope.size / 2));
          }
        }
      }
    }, 0);
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

ScaleControls.prototype = Object.create( EventDispatcher.prototype );
ScaleControls.prototype.constructor = ScaleControls;

export { ScaleControls };