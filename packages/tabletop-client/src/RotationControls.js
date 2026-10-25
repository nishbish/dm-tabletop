import {
  EventDispatcher,
  BufferGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Raycaster,
  Vector2,
  Vector3,
  Shape,
  ShapeGeometry,
  Path,
  PlaneGeometry
} from 'three';

var RotationControls = function (camera, domElement, scene, renderer, settings = {}) {

  var scope = this;

  this.enabled = true;
  this.isRotating = false;
  this.angle = 0;  
  this.object = null;
  this.snap = 0;
  this.axis = 'z';
  this.offset = new Vector3();

  var defaultSettings = {
    radius: 1,
    thickness: 0.5
  }

  //set default values
  for (const [name, value] of Object.entries(defaultSettings))
  {
    if (!(name in settings))
    {
      settings[name] = value;
    }
  }

  var holeRadius = settings.radius - settings.thickness;

  const circleShape = new Shape()
    .moveTo(settings.radius, 0 )
    .absarc( 0, 0, settings.radius, 0, Math.PI * 2, false );

  const holePath = new Path()
    .moveTo( holeRadius, 0 )
    .absarc( 0, 0, holeRadius, 0, Math.PI * 2, true );

  circleShape.holes.push( holePath );

  var geometry = new ShapeGeometry( circleShape );

  this.circle = new Mesh( geometry, new MeshBasicMaterial({ color: 0x0871FF }));
  this.circle.name = 'circle';
  this.circle.visible = false;
  scene.add(this.circle);

  const dotRadius = settings.thickness / 2;
  const dotShape = new Shape()
    .moveTo(dotRadius, 0 )
    .absarc( 0, 0, dotRadius, 0, Math.PI * 2, false );

  var geometry = new ShapeGeometry( dotShape );

  var dotMesh = new Mesh( geometry, new MeshBasicMaterial({ color: 0xffffff }));
  dotMesh.name = 'dot';
  this.circle.add( dotMesh );
  dotMesh.position.z = dotMesh.position.z + 0.01;
  dotMesh.position.y = dotMesh.position.y + settings.radius - dotRadius;

  //virtual plane
  var planeGeometry = new PlaneGeometry(10000, 10000);
  var planeMaterial = new MeshBasicMaterial({wireframe: true, color: 0xE219EF});
  var plane = new Mesh(planeGeometry, planeMaterial);
  plane.name = 'rotation plane';
  plane.visible = false;
  plane.rotation.set(-Math.PI / 2, 0, 0);
  scene.add(plane);
      
  var raycast = new Raycaster();

  //attach event
  this.attach = function ( object ) {      
    scope.object = object;
    scope.angle = object.rotation[this.axis];
    scope.visible = true;

    scope.circle.visible = true;
    scope.circle.rotation.set(-Math.PI / 2, 0, scope.angle);
    scope.updatePosition();

    return this;
  };

  //detach event
  this.detach = function () {
    scope.object = null;
    scope.visible = false;
    this.circle.visible = false;

    return this;
  };

  //pointer down
  this.pointerDown = function(e) {

    if (scope.object != null)
    {
      var pointerPos = scope.parsePointerPos(e);

      //raycaster
      raycast.setFromCamera(pointerPos, camera);
      var intersects = raycast.intersectObjects([dotMesh], false);      

      if (intersects.length > 0)
      {
        scope.isRotating = true;
        this.dispatchEvent( { type: 'rotatestart' } );
      }
    }
  }

  domElement.addEventListener('pointerdown', pointerDown, false);

  function pointerDown(e)
  {
    if (e.which == 1 && scope.enabled)
    {
      scope.pointerDown(e);
    }
  }

  //pointer up
  this.pointerUp = function(e) {
    // only the end of an actual turn counts; every other click used to send the transform again
    // (and rebuild the walls, for a door)
    if (scope.object != null && scope.isRotating)
    {
      scope.isRotating = false;
      this.dispatchEvent( { type: 'rotateend' } );
    }
  }

  domElement.addEventListener('pointerup', pointerUp, false);

  function pointerUp(e)
  {
    if (scope.enabled)
    {
      scope.pointerUp(e);
    }
  }

  //pointer move
  this.pointerMove = function(e) {
    if (this.object !== null && this.visible && this.isRotating) {
      
      var pointerPos = scope.parsePointerPos(e);

      raycast.setFromCamera(pointerPos, camera);
      var intersects = raycast.intersectObjects([plane], false);      
      
      if (intersects.length > 0)
      {
        var pos_x = intersects[0].point.x;
        var pos_z = intersects[0].point.z;

        var center_x = scope.circle.position.x;
        var center_z = scope.circle.position.z;

        var delta_x = center_x - pos_x;
        var delta_z = center_z - pos_z;

        this.angle = Math.atan2(delta_z, delta_x) * (180 / Math.PI);
        this.angle -= 90;
        if (this.angle < 0) {
          this.angle = 360 + this.angle;
        }
        this.angle = Math.round(this.angle);
        this.angle = this.angle * (Math.PI/180);

        //snap angle
        if (this.snap > 0)
        {
          this.angle = Math.round(this.angle / this.snap) * this.snap;
        }

        this.object.rotation[this.axis] = -this.angle;
        scope.circle.rotation.set(-Math.PI / 2, 0, -this.angle);
        
        this.dispatchEvent( { type: 'rotate' } );
      }
    }
  }

  domElement.addEventListener('pointermove', pointerMove, false);

  function pointerMove(e)
  {
    if (scope.enabled)
    {
      scope.pointerMove(e);
    } 
  }

  this.updatePosition = function()
  {
    setTimeout(function() {
      if (scope.object != null)
      {
        var position = scope.object.position.clone();
        plane.position.copy(position);
        scope.circle.position.copy(position);
        scope.circle.position.y = position.y + 0.1;
        scope.circle.position.add(scope.offset);
      }
    }, 0);
  }

  this.parsePointerPos = function (event)
  {
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

RotationControls.prototype = Object.create( EventDispatcher.prototype );
RotationControls.prototype.constructor = RotationControls;

export { RotationControls };