// NOTICE!! DO NOT USE ANY OF THIS JAVASCRIPT
// IT'S ALL JUST JUNK FOR OUR DOCS!
// ++++++++++++++++++++++++++++++++++++++++++

!function ($) {

  $(function(){

    // Disable certain links in docs
    $('section [href^=#]').click(function (e) {
      e.preventDefault()
    })

    // make code pretty
    window.prettyPrint && prettyPrint()

    // add-ons
    $('.add-on :checkbox').on('click', function () {
      var $this = $(this)
        , method = $this.attr('checked') ? 'addClass' : 'removeClass'
      $(this).parents('.add-on')[method]('active')
    })

    // position static twipsies for components page
    if ($(".twipsies a").length) {
      $(window).on('load resize', function () {
        $(".twipsies a").each(function () {
          $(this)
            .tooltip({
              placement: $(this).attr('title')
            , trigger: 'manual'
            })
            .tooltip('show')
          })
      })
    }

    // add tipsies to grid for scaffolding
    if ($('#grid-system').length) {
      $('#grid-system').tooltip({
          selector: '.show-grid > div'
        , title: function () { return $(this).width() + 'px' }
      })
    }

    // fix sub nav on scroll
    var $win = $(window)
      , $nav = $('.subnav')
      , navTop = $('.subnav').length && $('.subnav').offset().top - 40
      , isFixed = 0

    processScroll()

    $win.on('scroll', processScroll)

    function processScroll() {
      var i, scrollTop = $win.scrollTop()
      if (scrollTop >= navTop && !isFixed) {
        isFixed = 1
        $nav.addClass('subnav-fixed')
      } else if (scrollTop <= navTop && isFixed) {
        isFixed = 0
        $nav.removeClass('subnav-fixed')
      }
    }

    // tooltip demo
    $('.tooltip-demo.well').tooltip({
      selector: "a[rel=tooltip]"
    })

    $('.tooltip-test').tooltip()
    $('.popover-test').popover()

    // popover demo
    $("a[rel=popover]")
      .popover()
      .click(function(e) {
        e.preventDefault()
      })

    // button state demo
    $('#fat-btn')
      .click(function () {
        var btn = $(this)
        btn.button('loading')
        setTimeout(function () {
          btn.button('reset')
        }, 3000)
      })

    // carousel demo
    $('#myCarousel').carousel()

    // javascript build logic
    var inputsComponent = $("#components.download input")
      , inputsPlugin = $("#plugins.download input")
      , inputsVariables = $("#variables.download input")

    // toggle all plugin checkboxes
    $('#components.download .toggle-all').on('click', function (e) {
      e.preventDefault()
      inputsComponent.attr('checked', !inputsComponent.is(':checked'))
    })

    $('#plugins.download .toggle-all').on('click', function (e) {
      e.preventDefault()
      inputsPlugin.attr('checked', !inputsPlugin.is(':checked'))
    })

    $('#variables.download .toggle-all').on('click', function (e) {
      e.preventDefault()
      inputsVariables.val('')
    })

    // request built javascript
    $('.download-btn').on('click', function () {

      var css = $("#components.download input:checked")
            .map(function () { return this.value })
            .toArray()
        , js = $("#plugins.download input:checked")
            .map(function () { return this.value })
            .toArray()
        , vars = {}
        , img = ['glyphicons-halflings.png', 'glyphicons-halflings-white.png']

    $("#variables.download input")
      .each(function () {
        $(this).val() && (vars[ $(this).prev().text() ] = $(this).val())
      })

      $.ajax({
        type: 'POST'
      , url: 'http://bootstrap.herokuapp.com'
      , dataType: 'jsonpi'
      , params: {
          js: js
        , css: css
        , vars: vars
        , img: img
      }
      })
    })

  })

// Modified from the original jsonpi https://github.com/benvinegar/jquery-jsonpi
$.ajaxTransport('jsonpi', function(opts, originalOptions, jqXHR) {
  var url = opts.url;

  return {
    send: function(_, completeCallback) {
      var name = 'jQuery_iframe_' + jQuery.now()
        , iframe, form

      iframe = $('<iframe>')
        .attr('name', name)
        .appendTo('head')

      form = $('<form>')
        .attr('method', opts.type) // GET or POST
        .attr('action', url)
        .attr('target', name)

      $.each(opts.params, function(k, v) {

        $('<input>')
          .attr('type', 'hidden')
          .attr('name', k)
          .attr('value', typeof v == 'string' ? v : JSON.stringify(v))
          .appendTo(form)
      })

      form.appendTo('body').submit()
    }
  }
})

// Item delete (Contact/SMS)
$('.delete').live('click', function(e) {
    e.preventDefault();
    if (confirm('Are you sure you want to delete that item?')) {
        var element = $(this),
            form = $('<form></form>');
        form.attr({
            method: 'POST',
                action: element.attr('href')
        })
        .hide()
        .append('<input type="hidden" />')
        .find('input')
        .attr({
            'name': '_method',
            'value': 'delete'
        })
        .end()

        .appendTo($("body")).submit();
    }
});

// Item delete (Contact/SMS)
$('.deleteaccount').live('click', function(e) {
    e.preventDefault();
    if (confirm('Are you sure you want to delete your account? All stored data will be irrecoverably deleted.')) {
        var element = $(this),
            form = $('<form></form>');
        form.attr({
            method: 'POST',
                action: element.attr('href')
        })
        .hide()
        .append('<input type="hidden" />')
        .find('input')
        .attr({
            'name': '_method',
            'value': 'delete'
        })
        .end()

        .appendTo($("body")).submit();
    }
});

// Download all (Contact/SMS)
$('.downlod-all').live('click', function(e) {
    e.preventDefault();
    if (confirm('Download all items?')) {
        var element = $(this),
            form = $('<form></form>');
        form.attr({
            method: 'GET',
                action: element.attr('href')
        })
        .hide()
        .append('<input type="hidden" />')
        .find('input')
        .attr({
            'name': '_method',
            'value': 'get'
        })
        .end()

        .appendTo($("body")).submit();
    }
});

// Delete One (Pictures)
$('.delete-one').live('click', function(e) {
    e.preventDefault();
    if (confirm('Delete this item?')) {
        var element = $(this),
            form = $('<form></form>');
        form.attr({
            method: 'POST',
                action: element.attr('href')
        })
        .hide()
        .append('<input type="hidden" />')
        .find('input')
        .attr({
            'name': '_method',
            'value': 'delete'
        })
        .end()

        .appendTo($("body")).submit();
    }
});

// Share One (Pictures)
$('.share-one').live('click', function(e) {
    e.preventDefault();
    if (confirm('Share this item on Facebook? You may be temporarily redirected for authentication.')) {
        var element = $(this),
            form = $('<form></form>');
        form.attr({
            method: 'GET',
                action: element.attr('href')
        })
        .hide()
        .append('<input type="hidden" />')
        .find('input')
        .attr({
            'name': '_method',
            'value': 'get'
        })
        .end()

        .appendTo($("body")).submit();
    }
});

$('.destroy').live('click', function(e) {
    e.preventDefault();
    if (confirm('Are you sure?')) {
        var element = $(this),
            form = $('<form></form>');
        form
            .attr({
            method: 'POST',
            action: element.attr('href')
        })
            .hide()
            .append('<input type="hidden" />')
            .find('input')
            .attr({
                'name': '_method',
                'value': 'delete'
            })
            .end()
            .appendTo($("body")).submit();
    }
});

$('.addnumber').click(function() {
    var num     = $('.clonedNumber').length - 1;
    var newNum  = new Number(num + 1);
    if(num == -1) {
       num = '';
    }

    var newElem = $('#inputNum' + num).clone().attr('id', 'inputNum' + newNum).attr('style', 'display: block');
    newElem.children(':first').attr('id', 'numtype' + newNum).attr('name', 'contact[numtype][' + newNum + ']').attr('value', '');
    newElem.children(':nth-child(2)').attr('id', 'nums' + newNum).attr('name', 'contact[nums][' + newNum + ']').attr('value', '');

    $('#inputNum' + num).after(newElem);
});

$('.addemail').click(function() {
    var num     = $('.clonedEmail').length - 1;
    var newNum  = new Number(num + 1);
    if(num == -1) {
       num = '';
    }

    var newElem = $('#inputEm' + num).clone().attr('id', 'inputEm' + newNum).attr('style', 'display: block');
    newElem.children(':first').attr('id', 'emstype' + newNum).attr('name', 'contact[emstype][' + newNum + ']').attr('value', '');
    newElem.children(':nth-child(2)').attr('id', 'ems' + newNum).attr('name', 'contact[ems][' + newNum + ']').attr('value', '');

    $('#inputEm' + num).after(newElem);
});

}(window.jQuery)