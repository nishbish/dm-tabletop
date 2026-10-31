import {
  EventDispatcher,
  Raycaster,
  Vector2,
} from 'three';

var MouseHover = function (camera, domElement, renderer) {

  var scope = this;

  // replaced by the viewer when it switches between the 3D and the 2D view
  this.camera = camera;
  this.enabled = true;
  this.object = null;
  this.targets = [];

  var raycast = new Raycaster();

  //pointer move
  this.mouseMove = function(e) {
          
    var pointerPos = scope.parsePointerPos(e);

    raycast.setFromCamera(pointerPos, scope.camera);
    var intersects = raycast.intersectObjects(scope.targets, false);
    
    if (intersects.length > 0)
    {
      if (scope.object != intersects[0].object)
      {
        if (scope.object != null)
        {
          this.dispatchEvent( { type: 'hoveroff', object: scope.object } );
        }

        scope.object = intersects[0].object;
        this.dispatchEvent( { type: 'hoveron', object: scope.object } );
      }
    }
    else
    {
      if (scope.object != null)
      {
        this.dispatchEvent( { type: 'hoveroff', object: scope.object } );
        scope.object = null;
      }
    }
  }

  domElement.addEventListener('mousemove', mouseMove, false);

  function mouseMove(e)
  {
    if (scope.enabled)
    {
      scope.mouseMove(e);
    } 
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

MouseHover.prototype = Object.create( EventDispatcher.prototype );
MouseHover.prototype.constructor = MouseHover;

export { MouseHover };